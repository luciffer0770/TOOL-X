"""Planning/domain computations for Gantt, Calendar, and Network views."""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from psetw_platform.models import Activity, ActivityStatus
from psetw_platform.schemas import (
    CalendarActivityRow,
    CalendarBucket,
    GanttRow,
    MaterialHealth,
    NetworkEdge,
    NetworkGraph,
    NetworkNode,
    PhaseProgressRow,
    ScenarioImpactRow,
    ScenarioSimulationInput,
    ScenarioSimulationResult,
    TimelineBounds,
)
from psetw_platform.services.analytics import compute_dependency_health

DAY_HOURS = 24.0


@dataclass(frozen=True)
class _ScheduleRow:
    code: str
    name: str
    start: date
    finish: date
    duration_hours: float


def _parse_dependencies(raw_dependencies: list[str]) -> list[str]:
    parsed: list[str] = []
    for raw in raw_dependencies:
        for token in str(raw).replace(";", ",").split(","):
            normalized = token.strip()
            if normalized:
                parsed.append(normalized)
    # Keep stable order while deduplicating.
    return list(dict.fromkeys(parsed))


def _planned_duration_hours(activity: Activity) -> float:
    if activity.planned_start_date and activity.planned_end_date:
        delta_days = (activity.planned_end_date - activity.planned_start_date).days
        if delta_days > 0:
            return float(delta_days) * DAY_HOURS
    if activity.base_effort_hours > 0:
        return float(activity.base_effort_hours)
    return DAY_HOURS


def _delay_hours(activity: Activity, today: date | None = None) -> float:
    if activity.planned_end_date is None:
        return 0.0
    reference = today or date.today()
    if activity.actual_end_date:
        return float(max(0, (activity.actual_end_date - activity.planned_end_date).days)) * DAY_HOURS
    if activity.status == ActivityStatus.completed:
        return 0.0
    return float(max(0, (reference - activity.planned_end_date).days)) * DAY_HOURS


def _build_graph(activities: list[Activity]) -> tuple[dict[str, list[str]], dict[str, Activity]]:
    by_code = {activity.activity_code: activity for activity in activities if activity.activity_code}
    graph: dict[str, list[str]] = {}
    for code, activity in by_code.items():
        graph[code] = [dependency for dependency in _parse_dependencies(activity.dependencies) if dependency in by_code]
    return graph, by_code


def _topological_sort(graph: dict[str, list[str]]) -> list[str]:
    indegree = {node: 0 for node in graph}
    adjacency: dict[str, list[str]] = {node: [] for node in graph}

    for node, dependencies in graph.items():
        indegree[node] = len(dependencies)
        for dependency in dependencies:
            adjacency.setdefault(dependency, []).append(node)

    queue: deque[str] = deque(node for node, degree in indegree.items() if degree == 0)
    ordered: list[str] = []
    while queue:
        node = queue.popleft()
        ordered.append(node)
        for neighbor in adjacency.get(node, []):
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)

    if len(ordered) < len(indegree):
        for node in indegree:
            if node not in ordered:
                ordered.append(node)
    return ordered


def _critical_path_codes(activities: list[Activity]) -> list[str]:
    graph, by_code = _build_graph(activities)
    order = _topological_sort(graph)
    finish_times: dict[str, float] = {}
    predecessor: dict[str, str | None] = {}

    for code in order:
        dependencies = graph.get(code, [])
        best_finish = 0.0
        best_parent: str | None = None
        for dependency in dependencies:
            dependency_finish = finish_times.get(dependency, 0.0)
            if dependency_finish > best_finish:
                best_finish = dependency_finish
                best_parent = dependency
        finish_times[code] = best_finish + _planned_duration_hours(by_code[code])
        predecessor[code] = best_parent

    if not finish_times:
        return []

    terminal = max(finish_times, key=finish_times.get)
    path: list[str] = []
    cursor: str | None = terminal
    while cursor:
        path.append(cursor)
        cursor = predecessor.get(cursor)
    path.reverse()
    return path


def _blocking_dependencies(activity: Activity, by_code: dict[str, Activity]) -> list[str]:
    blocking: list[str] = []
    for dependency in _parse_dependencies(activity.dependencies):
        parent = by_code.get(dependency)
        if parent and parent.status != ActivityStatus.completed:
            blocking.append(dependency)
    return blocking


def compute_timeline_bounds(activities: list[Activity]) -> TimelineBounds:
    starts: list[date] = []
    finishes: list[date] = []
    for activity in activities:
        if activity.planned_start_date:
            starts.append(activity.planned_start_date)
        elif activity.actual_start_date:
            starts.append(activity.actual_start_date)

        if activity.planned_end_date:
            finishes.append(activity.planned_end_date)
        elif activity.actual_end_date:
            finishes.append(activity.actual_end_date)

    if not starts or not finishes:
        today = date.today()
        return TimelineBounds(min_date=today - timedelta(days=3), max_date=today + timedelta(days=14))
    return TimelineBounds(min_date=min(starts) - timedelta(days=1), max_date=max(finishes) + timedelta(days=1))


def compute_phase_progress(activities: list[Activity], today: date | None = None) -> list[PhaseProgressRow]:
    by_phase: dict[str, list[Activity]] = defaultdict(list)
    for activity in activities:
        phase = activity.phase.strip() or "Unassigned"
        by_phase[phase].append(activity)

    rows: list[PhaseProgressRow] = []
    for phase, phase_activities in sorted(by_phase.items(), key=lambda entry: entry[0].lower()):
        total = len(phase_activities)
        average_completion = round(
            sum(activity.completion_percentage for activity in phase_activities) / total if total else 0.0,
            2,
        )
        delayed = sum(1 for activity in phase_activities if _delay_hours(activity, today) > 0)
        rows.append(
            PhaseProgressRow(
                phase=phase,
                activity_count=total,
                average_completion=average_completion,
                delayed_activities=delayed,
            )
        )
    return rows


def compute_gantt_rows(
    activities: list[Activity], phase_filter: str | None = None, status_filter: ActivityStatus | None = None
) -> list[GanttRow]:
    graph, by_code = _build_graph(activities)
    critical_path = set(_critical_path_codes(activities))
    normalized_phase = phase_filter.strip().lower() if phase_filter else ""

    rows: list[GanttRow] = []
    for activity in activities:
        if normalized_phase and activity.phase.strip().lower() != normalized_phase:
            continue
        if status_filter and activity.status != status_filter:
            continue

        dependencies = _parse_dependencies(activity.dependencies)
        rows.append(
            GanttRow(
                activity_id=activity.id,
                activity_code=activity.activity_code,
                activity_name=activity.activity_name,
                phase=activity.phase,
                status=activity.status,
                planned_start_date=activity.planned_start_date,
                planned_end_date=activity.planned_end_date,
                planned_duration_hours=round(_planned_duration_hours(activity), 2),
                completion_percentage=activity.completion_percentage,
                risk_score=activity.risk_score,
                delay_hours=round(_delay_hours(activity), 2),
                dependencies=dependencies,
                blocking_dependencies=_blocking_dependencies(activity, by_code),
                critical_path=activity.activity_code in critical_path,
            )
        )

    rows.sort(
        key=lambda row: (
            row.planned_start_date or date.max,
            row.activity_code.lower(),
        )
    )
    # Keep graph variable used to satisfy static analyzers if filtering is empty.
    _ = graph
    return rows


def compute_calendar_buckets(activities: list[Activity], start: date, end: date) -> list[CalendarBucket]:
    by_day: dict[date, list[CalendarActivityRow]] = defaultdict(list)
    for activity in activities:
        anchor = activity.planned_start_date or activity.planned_end_date or activity.actual_start_date
        if anchor is None or anchor < start or anchor > end:
            continue
        by_day[anchor].append(
            CalendarActivityRow(
                activity_id=activity.id,
                activity_code=activity.activity_code,
                activity_name=activity.activity_name,
                status=activity.status,
                phase=activity.phase,
                completion_percentage=activity.completion_percentage,
            )
        )

    buckets: list[CalendarBucket] = []
    cursor = start
    while cursor <= end:
        rows = sorted(by_day.get(cursor, []), key=lambda item: item.activity_code.lower())
        buckets.append(CalendarBucket(day=cursor, activities=rows))
        cursor += timedelta(days=1)
    return buckets


def compute_network_graph(activities: list[Activity]) -> NetworkGraph:
    graph, by_code = _build_graph(activities)
    critical_codes = set(_critical_path_codes(activities))
    dependency_health = compute_dependency_health(activities)

    nodes: list[NetworkNode] = []
    for activity in sorted(activities, key=lambda row: row.activity_code.lower()):
        nodes.append(
            NetworkNode(
                activity_id=activity.id,
                activity_code=activity.activity_code,
                activity_name=activity.activity_name,
                status=activity.status,
                risk_score=activity.risk_score,
                blocked=bool(_blocking_dependencies(activity, by_code)),
                critical=activity.activity_code in critical_codes,
            )
        )

    edges: list[NetworkEdge] = []
    for dependent_code, dependencies in graph.items():
        for dependency_code in dependencies:
            edges.append(NetworkEdge(dependency_code=dependency_code, dependent_code=dependent_code))

    return NetworkGraph(
        nodes=nodes,
        edges=edges,
        critical_path_codes=sorted(critical_codes),
        cycle_activity_ids=sorted(dependency_health.cycle_activity_ids),
        missing_by_activity=dependency_health.missing_by_activity,
    )


def compute_material_health(activities: list[Activity], today: date | None = None) -> MaterialHealth:
    reference = today or date.today()
    ownership_counts: dict[str, int] = defaultdict(int)
    status_counts: dict[str, int] = defaultdict(int)
    pending_critical = 0
    late_material = 0

    for activity in activities:
        ownership_counts[activity.material_ownership or "Unspecified"] += 1
        status_counts[activity.material_status or "Unspecified"] += 1

        criticality = activity.material_criticality.strip().lower()
        material_received = (activity.material_status or "").strip().lower() == "received"
        if criticality in {"critical", "high"} and not material_received:
            pending_critical += 1

        required = activity.material_required_date
        received_date = activity.material_received_date
        if required is None:
            continue
        if received_date and received_date > required:
            late_material += 1
        elif received_date is None and required < reference:
            late_material += 1

    return MaterialHealth(
        ownership_counts=dict(ownership_counts),
        status_counts=dict(status_counts),
        pending_critical_count=pending_critical,
        late_material_count=late_material,
    )


def _adjusted_duration_hours(activity: Activity, scenario: ScenarioSimulationInput) -> float:
    base_duration = max(1.0, _planned_duration_hours(activity))
    manpower_level = max(1, activity.assigned_manpower)
    efficiency_gain = (scenario.manpower_boost_pct / 100.0) * min(1.5, manpower_level / 4.0)
    manpower_adjusted = base_duration / (1.0 + efficiency_gain)
    overtime_gain = scenario.overtime_hours_per_day * max(1.0, manpower_adjusted / 8.0) * 0.35
    production_adjusted = max(1.0, manpower_adjusted - overtime_gain)

    material_penalty = 0.0
    if (activity.material_status or "").strip().lower() != "received":
        material_penalty = float(max(0, activity.material_lead_time)) * (
            1.0 - max(0.0, min(100.0, scenario.lead_time_reduction_pct)) / 100.0
        )
    return production_adjusted + material_penalty


def _schedule_by_dependencies(
    activities: list[Activity], scenario: ScenarioSimulationInput
) -> tuple[list[_ScheduleRow], date | None]:
    graph, by_code = _build_graph(activities)
    order = _topological_sort(graph)

    planned_starts = [activity.planned_start_date for activity in activities if activity.planned_start_date]
    fallback_start = min(planned_starts) if planned_starts else date.today()
    finish_by_code: dict[str, date] = {}
    rows: list[_ScheduleRow] = []

    for code in order:
        activity = by_code.get(code)
        if activity is None:
            continue
        dependency_finishes = [finish_by_code[dependency] for dependency in graph.get(code, []) if dependency in finish_by_code]
        dependency_gate = max(dependency_finishes) if dependency_finishes else fallback_start
        planned_start = activity.planned_start_date or fallback_start
        start = max(planned_start, dependency_gate)

        duration_hours = _adjusted_duration_hours(activity, scenario)
        duration_days = max(1, int((duration_hours + DAY_HOURS - 1) // DAY_HOURS))
        finish = start + timedelta(days=duration_days)

        finish_by_code[code] = finish
        rows.append(
            _ScheduleRow(
                code=code,
                name=activity.activity_name,
                start=start,
                finish=finish,
                duration_hours=round(duration_hours, 2),
            )
        )

    project_finish = max(finish_by_code.values()) if finish_by_code else None
    return rows, project_finish


def simulate_scenario(
    activities: list[Activity], scenario: ScenarioSimulationInput
) -> ScenarioSimulationResult:
    baseline_input = ScenarioSimulationInput(
        manpower_boost_pct=0.0,
        overtime_hours_per_day=0.0,
        lead_time_reduction_pct=0.0,
    )
    baseline_rows, baseline_finish = _schedule_by_dependencies(activities, baseline_input)
    simulated_rows, simulated_finish = _schedule_by_dependencies(activities, scenario)
    baseline_by_code = {row.code: row for row in baseline_rows}

    impacts: list[ScenarioImpactRow] = []
    for simulated in simulated_rows:
        baseline = baseline_by_code.get(simulated.code)
        if baseline is None:
            continue
        saved = round(baseline.duration_hours - simulated.duration_hours, 2)
        impacts.append(
            ScenarioImpactRow(
                activity_code=simulated.code,
                activity_name=simulated.name,
                start_date=simulated.start,
                finish_date=simulated.finish,
                baseline_duration_hours=baseline.duration_hours,
                simulated_duration_hours=simulated.duration_hours,
                saved_hours=saved,
            )
        )
    impacts.sort(key=lambda row: row.saved_hours, reverse=True)

    improvement_hours = 0.0
    if baseline_finish and simulated_finish:
        improvement_hours = round(
            (datetime.combine(baseline_finish, datetime.min.time()) - datetime.combine(simulated_finish, datetime.min.time()))
            .total_seconds()
            / 3600.0,
            2,
        )

    return ScenarioSimulationResult(
        baseline_finish_date=baseline_finish,
        simulated_finish_date=simulated_finish,
        improvement_hours=improvement_hours,
        impacts=impacts,
    )
