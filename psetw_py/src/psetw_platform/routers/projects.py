"""Project management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from psetw_platform.dependencies import CurrentUser, DBSession, require_roles
from psetw_platform.models import Project, UserRole
from psetw_platform.schemas import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _next_project_code(existing_codes: set[str]) -> str:
    index = 1
    while True:
        candidate = f"PRJ-{index:04d}"
        if candidate not in existing_codes:
            return candidate
        index += 1


@router.get("", response_model=list[ProjectOut])
def list_projects(db: DBSession, _: CurrentUser) -> list[Project]:
    """Return all projects."""

    return list(
        db.scalars(select(Project).where(Project.is_archived.is_(False)).order_by(Project.created_at.desc())).all()
    )


@router.post(
    "",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def create_project(payload: ProjectCreate, db: DBSession, user: CurrentUser) -> Project:
    """Create a project."""

    existing_codes = {
        code.strip().upper()
        for code in db.scalars(select(Project.project_code)).all()
        if code and code.strip()
    }
    project = Project(
        name=payload.name.strip(),
        project_code=_next_project_code(existing_codes),
        created_by=user.username,
        updated_by=user.username,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.put(
    "/{project_id}",
    response_model=ProjectOut,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def update_project(project_id: str, payload: ProjectUpdate, db: DBSession, user: CurrentUser) -> Project:
    """Rename project."""

    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    project.name = payload.name.strip()
    project.updated_by = user.username
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
