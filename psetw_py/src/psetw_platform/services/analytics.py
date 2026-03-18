"""Domain analytics functions implemented in Python."""

from __future__ import annotations

from datetime import date

from psetw_platform.models import Activity, ActivityStatus
from psetw_platform.schemas import AnomalyRow, DelayRiskRow, DependencyHealth, PortfolioMetrics


def _risk_level(score: int) -> str:
    if score >= 75:
        return "Critical"
    if score >= 55:
        return "High"
    if score >= 30:
        return "Medium"
    return "Low"


def _is_delayed(activity: Activity, reference_day: date) -> bool:
    if activity.status == ActivityStatus.delayed:
        return True
    if activity.status == ActivityStatus.completed:
        return False
    return activity.planned_end_date is not None and activity.planned_end_date < reference_day


def _delay_days(activity: Activity, reference_day: date) -> int:
    if not _is_delayed(activity, reference_day):
        return 0
    if activity.planned_end_date is None:
        return 0
    return max(0, (reference_day - activity.planned_end_date).days)


def _is_blocked(activity: Activity, by_code: dict[str, Activity]) -> bool:
    if activity.status == ActivityStatus.blocked:
        return True
    if not activity.dependencies:
        return False
    for dependency_code in activity.dependencies:
        parent = by_code.get(dependency_code)
        if parent and parent.status != ActivityStatus.completed:
            return True
    return False


def compute_dependency_health(activities: list[Activity]) -> DependencyHealth:
    """Compute dependency integrity and cycle health."""

    by_code = {activity.activity_code: activity for activity in activities if activity.activity_code}
    missing_by_activity: dict[str, list[str]] = {}
    missing_links = 0

    for activity in activities:
        missing = [dep for dep in activity.dependencies if dep not in by_code]
        if missing:
            missing_by_activity[activity.id] = missing
            missing_links += len(missing)

    graph = {code: [dep for dep in act.dependencies if dep in by_code] for code, act in by_code.items()}
    visited: set[str] = set()
    visiting: set[str] = set()
    stack: list[str] = []
    cycle_nodes: set[str] = set()

    def dfs(node: str) -> None:
        visiting.add(node)
        stack.append(node)
        for dep in graph.get(node, []):
            if dep in visiting:
                start_idx = stack.index(dep)
                cycle_nodes.update(stack[start_idx:])
                cycle_nodes.add(dep)
            elif dep not in visited:
                dfs(dep)
        stack.pop()
        visiting.remove(node)
        visited.add(node)

    for node in graph:
        if node not in visited:
            dfs(node)

    cycle_activity_ids = [
        activity.id for activity in activities if activity.activity_code in cycle_nodes and activity.id
    ]
    return DependencyHealth(
        missing_by_activity=missing_by_activity,
        missing_dependency_links=missing_links,
        activities_with_missing_dependencies=len(missing_by_activity),
        cycle_activity_ids=cycle_activity_ids,
        cycle_count=len(cycle_activity_ids),
    )


def compute_portfolio_metrics(activities: list[Activity], reference_day: date | None = None) -> PortfolioMetrics:
    """Compute dashboard-level portfolio metrics."""

    today = reference_day or date.today()
    total = len(activities)
    if total == 0:
        return PortfolioMetrics(
            total_activities=0,
            delayed_activities=0,
            high_risk_activities=0,
            completed_activities=0,
            blocked_activities=0,
            average_completion=0.0,
        )

    by_code = {activity.activity_code: activity for activity in activities}
    delayed = sum(1 for activity in activities if _is_delayed(activity, today))
    high_risk = sum(1 for activity in activities if activity.risk_score >= 55)
    completed = sum(1 for activity in activities if activity.status == ActivityStatus.completed)
    blocked = sum(1 for activity in activities if _is_blocked(activity, by_code))
    avg_completion = round(sum(activity.completion_percentage for activity in activities) / total, 2)

    return PortfolioMetrics(
        total_activities=total,
        delayed_activities=delayed,
        high_risk_activities=high_risk,
        completed_activities=completed,
        blocked_activities=blocked,
        average_completion=avg_completion,
    )


def compute_delay_risk_rows(activities: list[Activity], reference_day: date | None = None) -> list[DelayRiskRow]:
    """Return delayed or high-risk activities for risk register tables."""

    today = reference_day or date.today()
    by_code = {activity.activity_code: activity for activity in activities}
    rows: list[DelayRiskRow] = []

    for activity in activities:
        delayed = _is_delayed(activity, today)
        if not delayed and activity.risk_score < 55:
            continue
        blocking = [
            dep
            for dep in activity.dependencies
            if (parent := by_code.get(dep)) is not None and parent.status != ActivityStatus.completed
        ]
        rows.append(
            DelayRiskRow(
                activity_id=activity.id,
                activity_code=activity.activity_code,
                activity_name=activity.activity_name,
                phase=activity.phase,
                status=activity.status,
                completion_percentage=activity.completion_percentage,
                risk_score=activity.risk_score,
                risk_level=_risk_level(activity.risk_score),
                delayed=delayed,
                delay_days=_delay_days(activity, today),
                blocking_dependencies=blocking,
                delay_reason=activity.delay_reason,
            )
        )

    rows.sort(key=lambda row: (row.delay_days, row.risk_score), reverse=True)
    return rows


def detect_activity_anomalies(activities: list[Activity], reference_day: date | None = None) -> list[AnomalyRow]:
    """Detect common schedule and data anomalies."""

    today = reference_day or date.today()
    anomalies: list[AnomalyRow] = []
    by_code = {activity.activity_code: activity for activity in activities}

    for activity in activities:
        if activity.actual_end_date and activity.completion_percentage < 100:
            anomalies.append(
                AnomalyRow(
                    rule_id="ACT-001",
                    activity_id=activity.id,
                    activity_code=activity.activity_code,
                    activity_name=activity.activity_name,
                    severity="High",
                    issue="Actual end date present with incomplete progress",
                    details=f"Completion is {activity.completion_percentage}% but actual_end_date is set.",
                    recommendation="Set completion to 100 or clear actual end date.",
                )
            )
        if _is_delayed(activity, today) and not activity.delay_reason.strip():
            anomalies.append(
                AnomalyRow(
                    rule_id="ACT-002",
                    activity_id=activity.id,
                    activity_code=activity.activity_code,
                    activity_name=activity.activity_name,
                    severity="Medium",
                    issue="Delayed activity has no delay reason",
                    details="Activity is delayed but delay_reason is empty.",
                    recommendation="Provide a concise delay reason for traceability.",
                )
            )
        if activity.completion_percentage == 100 and activity.status != ActivityStatus.completed:
            anomalies.append(
                AnomalyRow(
                    rule_id="ACT-003",
                    activity_id=activity.id,
                    activity_code=activity.activity_code,
                    activity_name=activity.activity_name,
                    severity="Low",
                    issue="Completion/status mismatch",
                    details="Completion is 100% but status is not Completed.",
                    recommendation="Set status to completed or adjust completion percentage.",
                )
            )
        missing_deps = [dep for dep in activity.dependencies if dep not in by_code]
        if missing_deps:
            anomalies.append(
                AnomalyRow(
                    rule_id="ACT-004",
                    activity_id=activity.id,
                    activity_code=activity.activity_code,
                    activity_name=activity.activity_name,
                    severity="High",
                    issue="Dependency references missing activity codes",
                    details=f"Missing dependencies: {', '.join(sorted(missing_deps))}",
                    recommendation="Fix dependency codes or create missing activities.",
                )
            )

    return anomalies
