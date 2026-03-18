"""Scenario persistence endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from atlas_platform.dependencies import CurrentUser, DBSession
from atlas_platform.models import Project, Scenario
from atlas_platform.schemas import ScenarioCreate, ScenarioOut

router = APIRouter(prefix="/projects/{project_id}/scenarios", tags=["scenarios"])


def _resolve_project(db: DBSession, project_id: str) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("", response_model=list[ScenarioOut])
def list_scenarios(project_id: str, db: DBSession, _: CurrentUser) -> list[Scenario]:
    """List saved project scenarios."""

    _resolve_project(db, project_id)
    stmt = select(Scenario).where(Scenario.project_id == project_id).order_by(Scenario.saved_at.desc())
    return list(db.scalars(stmt).all())


@router.post("", response_model=ScenarioOut, status_code=status.HTTP_201_CREATED)
def create_scenario(project_id: str, payload: ScenarioCreate, db: DBSession, user: CurrentUser) -> Scenario:
    """Persist a simulation scenario and result."""

    _resolve_project(db, project_id)
    scenario = Scenario(
        project_id=project_id,
        name=payload.name.strip(),
        scenario_input=payload.scenario_input,
        scenario_result=payload.scenario_result,
        saved_by=user.username,
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return scenario
