"""Analytics endpoints for project KPI consumption."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from psetw_platform.dependencies import CurrentUser, DBSession
from psetw_platform.models import Activity, Project
from psetw_platform.schemas import AnomalyRow, DelayRiskRow, DependencyHealth, PortfolioMetrics
from psetw_platform.services.analytics import (
    compute_delay_risk_rows,
    compute_dependency_health,
    compute_portfolio_metrics,
    detect_activity_anomalies,
)

router = APIRouter(prefix="/projects/{project_id}/analytics", tags=["analytics"])


@router.get("/portfolio-metrics", response_model=PortfolioMetrics)
def get_portfolio_metrics(project_id: str, db: DBSession, _: CurrentUser) -> PortfolioMetrics:
    """Compute and return project portfolio metrics."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    activities = list(db.scalars(select(Activity).where(Activity.project_id == project_id)).all())
    return compute_portfolio_metrics(activities)


@router.get("/delay-risk", response_model=list[DelayRiskRow])
def get_delay_risk(project_id: str, db: DBSession, _: CurrentUser) -> list[DelayRiskRow]:
    """Return delayed/high-risk activity rows for risk dashboards."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    activities = list(db.scalars(select(Activity).where(Activity.project_id == project_id)).all())
    return compute_delay_risk_rows(activities)


@router.get("/dependency-health", response_model=DependencyHealth)
def get_dependency_health(project_id: str, db: DBSession, _: CurrentUser) -> DependencyHealth:
    """Return dependency link/cycle quality for project activities."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    activities = list(db.scalars(select(Activity).where(Activity.project_id == project_id)).all())
    return compute_dependency_health(activities)


@router.get("/anomalies", response_model=list[AnomalyRow])
def get_anomalies(project_id: str, db: DBSession, _: CurrentUser) -> list[AnomalyRow]:
    """Return data/schedule anomalies detected for current activities."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    activities = list(db.scalars(select(Activity).where(Activity.project_id == project_id)).all())
    return detect_activity_anomalies(activities)
