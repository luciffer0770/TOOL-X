"""Analytics endpoints for project KPI consumption."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from atlas_platform.dependencies import CurrentUser, DBSession
from atlas_platform.models import Activity, Project
from atlas_platform.schemas import PortfolioMetrics
from atlas_platform.services.analytics import compute_portfolio_metrics

router = APIRouter(prefix="/projects/{project_id}/analytics", tags=["analytics"])


@router.get("/portfolio-metrics", response_model=PortfolioMetrics)
def get_portfolio_metrics(project_id: str, db: DBSession, _: CurrentUser) -> PortfolioMetrics:
    """Compute and return project portfolio metrics."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    activities = list(db.scalars(select(Activity).where(Activity.project_id == project_id)).all())
    return compute_portfolio_metrics(activities)
