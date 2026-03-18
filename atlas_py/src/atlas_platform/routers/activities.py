"""Activity management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from atlas_platform.dependencies import CurrentUser, DBSession, require_roles
from atlas_platform.models import Activity, Project, UserRole
from atlas_platform.schemas import ActivityCreate, ActivityOut, ActivityUpdate

router = APIRouter(prefix="/projects/{project_id}/activities", tags=["activities"])


TECHNICIAN_ALLOWED_FIELDS = {
    "status",
    "completion_percentage",
    "actual_start_date",
    "actual_end_date",
    "delay_reason",
    "remarks",
}


def _resolve_project(db: DBSession, project_id: str) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("", response_model=list[ActivityOut])
def list_activities(project_id: str, db: DBSession, _: CurrentUser) -> list[Activity]:
    """List all activities for a project."""

    _resolve_project(db, project_id)
    stmt = select(Activity).where(Activity.project_id == project_id).order_by(Activity.created_at.asc())
    return list(db.scalars(stmt).all())


@router.post("", response_model=ActivityOut, status_code=status.HTTP_201_CREATED)
def create_activity(project_id: str, payload: ActivityCreate, db: DBSession, _: CurrentUser) -> Activity:
    """Create activity inside a project."""

    _resolve_project(db, project_id)
    exists = db.scalar(
        select(Activity).where(Activity.project_id == project_id, Activity.activity_code == payload.activity_code)
    )
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Activity code already exists")

    activity = Activity(project_id=project_id, **payload.model_dump())
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


@router.patch("/{activity_id}", response_model=ActivityOut)
def update_activity(
    project_id: str,
    activity_id: str,
    payload: ActivityUpdate,
    db: DBSession,
    user: CurrentUser,
) -> Activity:
    """Patch an activity with role-aware field controls."""

    _resolve_project(db, project_id)
    activity = db.scalar(
        select(Activity).where(Activity.id == activity_id, Activity.project_id == project_id)
    )
    if activity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")

    patch = payload.model_dump(exclude_unset=True)
    if user.role == UserRole.technician:
        forbidden = sorted(set(patch).difference(TECHNICIAN_ALLOWED_FIELDS))
        if forbidden:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Technician cannot modify fields: {', '.join(forbidden)}",
            )

    for field, value in patch.items():
        setattr(activity, field, value)
    db.commit()
    db.refresh(activity)
    return activity


@router.delete(
    "/{activity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def delete_activity(project_id: str, activity_id: str, db: DBSession, _: CurrentUser) -> None:
    """Delete activity from project."""

    _resolve_project(db, project_id)
    activity = db.scalar(
        select(Activity).where(Activity.id == activity_id, Activity.project_id == project_id)
    )
    if activity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")
    db.delete(activity)
    db.commit()
