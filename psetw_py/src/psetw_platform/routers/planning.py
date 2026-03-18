"""Planning endpoints for Gantt/Calendar/Network and simulations."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from psetw_platform.dependencies import CurrentUser, DBSession
from psetw_platform.models import Activity, ActivityStatus, Project
from psetw_platform.schemas import (
    CalendarBucket,
    GanttRow,
    MaterialHealth,
    NetworkGraph,
    PhaseProgressRow,
    ScenarioSimulationInput,
    ScenarioSimulationResult,
    TimelineBounds,
)
from psetw_platform.services.planning import (
    compute_calendar_buckets,
    compute_gantt_rows,
    compute_material_health,
    compute_network_graph,
    compute_phase_progress,
    compute_timeline_bounds,
    simulate_scenario,
)

router = APIRouter(prefix="/projects/{project_id}/planning", tags=["planning"])


def _resolve_project(db: DBSession, project_id: str) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _load_activities(db: DBSession, project_id: str) -> list[Activity]:
    return list(
        db.scalars(select(Activity).where(Activity.project_id == project_id).order_by(Activity.created_at.asc())).all()
    )


@router.get("/timeline-bounds", response_model=TimelineBounds)
def get_timeline_bounds(project_id: str, db: DBSession, _: CurrentUser) -> TimelineBounds:
    """Return effective project timeline bounds used by planning views."""

    _resolve_project(db, project_id)
    return compute_timeline_bounds(_load_activities(db, project_id))


@router.get("/phase-progress", response_model=list[PhaseProgressRow])
def get_phase_progress(project_id: str, db: DBSession, _: CurrentUser) -> list[PhaseProgressRow]:
    """Return aggregated progress data per project phase."""

    _resolve_project(db, project_id)
    return compute_phase_progress(_load_activities(db, project_id))


@router.get("/gantt", response_model=list[GanttRow])
def get_gantt_rows(
    project_id: str,
    db: DBSession,
    _: CurrentUser,
    phase: str | None = Query(default=None),
    status_filter: ActivityStatus | None = Query(default=None, alias="status"),
) -> list[GanttRow]:
    """Return activity rows enriched for Gantt chart rendering."""

    _resolve_project(db, project_id)
    return compute_gantt_rows(_load_activities(db, project_id), phase_filter=phase, status_filter=status_filter)


@router.get("/calendar", response_model=list[CalendarBucket])
def get_calendar_buckets(
    project_id: str,
    db: DBSession,
    _: CurrentUser,
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
) -> list[CalendarBucket]:
    """Return day buckets with activities for a date window."""

    _resolve_project(db, project_id)
    bounds = compute_timeline_bounds(_load_activities(db, project_id))
    start_date = start or bounds.min_date
    end_date = end or bounds.max_date
    if end_date < start_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="end must be >= start")
    if (end_date - start_date).days > 120:
        end_date = start_date + timedelta(days=120)
    return compute_calendar_buckets(_load_activities(db, project_id), start=start_date, end=end_date)


@router.get("/network", response_model=NetworkGraph)
def get_network_graph(project_id: str, db: DBSession, _: CurrentUser) -> NetworkGraph:
    """Return dependency graph payload for network visualization."""

    _resolve_project(db, project_id)
    return compute_network_graph(_load_activities(db, project_id))


@router.get("/materials-health", response_model=MaterialHealth)
def get_materials_health(project_id: str, db: DBSession, _: CurrentUser) -> MaterialHealth:
    """Return material ownership/status summary and critical delays."""

    _resolve_project(db, project_id)
    return compute_material_health(_load_activities(db, project_id))


@router.post("/simulate", response_model=ScenarioSimulationResult)
def run_scenario_simulation(
    project_id: str, payload: ScenarioSimulationInput, db: DBSession, _: CurrentUser
) -> ScenarioSimulationResult:
    """Run dependency-based what-if simulation for current project activities."""

    _resolve_project(db, project_id)
    return simulate_scenario(_load_activities(db, project_id), payload)
