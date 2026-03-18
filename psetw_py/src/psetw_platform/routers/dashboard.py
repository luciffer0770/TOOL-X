"""Dashboard aggregation endpoints."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from psetw_platform.dependencies import CurrentUser, DBSession
from psetw_platform.models import ActionItem, ActionStatus, Activity, Project
from psetw_platform.schemas import ActionSummary, AnomalySummary, DashboardOverview
from psetw_platform.services.analytics import (
    compute_delay_risk_rows,
    compute_dependency_health,
    compute_portfolio_metrics,
    detect_activity_anomalies,
)
from psetw_platform.services.planning import (
    compute_critical_path_codes,
    compute_phase_progress,
    compute_timeline_bounds,
)

router = APIRouter(prefix="/projects/{project_id}/dashboard", tags=["dashboard"])


def _resolve_project(db: DBSession, project_id: str) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("/overview", response_model=DashboardOverview)
def get_dashboard_overview(project_id: str, db: DBSession, _: CurrentUser) -> DashboardOverview:
    """Return all core dashboard KPIs in one payload."""

    _resolve_project(db, project_id)
    activities = list(
        db.scalars(select(Activity).where(Activity.project_id == project_id).order_by(Activity.created_at.asc())).all()
    )
    actions = list(db.scalars(select(ActionItem).where(ActionItem.project_id == project_id)).all())

    portfolio_metrics = compute_portfolio_metrics(activities)
    timeline_bounds = compute_timeline_bounds(activities)
    phase_progress = compute_phase_progress(activities)
    top_risks = compute_delay_risk_rows(activities)[:10]
    dependency_health = compute_dependency_health(activities)
    anomalies = detect_activity_anomalies(activities)
    critical_path_codes = compute_critical_path_codes(activities)

    severity_counts: dict[str, int] = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}
    for anomaly in anomalies:
        severity = anomaly.severity if anomaly.severity in severity_counts else "Low"
        severity_counts[severity] += 1

    today = date.today()
    overdue_actions = 0
    open_actions = 0
    for action in actions:
        is_open = action.status != ActionStatus.closed
        if is_open:
            open_actions += 1
        if is_open and action.due_date and action.due_date < today:
            overdue_actions += 1

    return DashboardOverview(
        portfolio_metrics=portfolio_metrics,
        timeline_bounds=timeline_bounds,
        phase_progress=phase_progress,
        top_risks=top_risks,
        dependency_health=dependency_health,
        anomaly_summary=AnomalySummary(total=len(anomalies), by_severity=severity_counts),
        action_summary=ActionSummary(
            total_actions=len(actions),
            open_actions=open_actions,
            overdue_actions=overdue_actions,
        ),
        critical_path_codes=critical_path_codes,
    )
