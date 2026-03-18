"""Project management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from psetw_platform.dependencies import CurrentUser, DBSession, require_roles
from psetw_platform.models import Project, UserRole
from psetw_platform.schemas import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: DBSession, _: CurrentUser) -> list[Project]:
    """Return all projects."""

    return list(db.scalars(select(Project).order_by(Project.created_at.desc())).all())


@router.post(
    "",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def create_project(payload: ProjectCreate, db: DBSession, user: CurrentUser) -> Project:
    """Create a project."""

    project = Project(name=payload.name.strip(), created_by=user.username)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.put(
    "/{project_id}",
    response_model=ProjectOut,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def update_project(project_id: str, payload: ProjectUpdate, db: DBSession, _: CurrentUser) -> Project:
    """Rename project."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    project.name = payload.name.strip()
    db.commit()
    db.refresh(project)
    return project


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def delete_project(project_id: str, db: DBSession, _: CurrentUser) -> None:
    """Delete a project."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    db.delete(project)
    db.commit()
