"""Corrective/mitigation action endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from atlas_platform.dependencies import CurrentUser, DBSession
from atlas_platform.models import ActionItem, Activity, Project
from atlas_platform.schemas import ActionCreate, ActionOut, ActionUpdate

router = APIRouter(prefix="/projects/{project_id}/actions", tags=["actions"])


def _resolve_project(db: DBSession, project_id: str) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("", response_model=list[ActionOut])
def list_actions(project_id: str, db: DBSession, _: CurrentUser) -> list[ActionItem]:
    """List project actions."""

    _resolve_project(db, project_id)
    stmt = select(ActionItem).where(ActionItem.project_id == project_id).order_by(ActionItem.updated_at.desc())
    return list(db.scalars(stmt).all())


@router.post("", response_model=ActionOut, status_code=status.HTTP_201_CREATED)
def create_action(project_id: str, payload: ActionCreate, db: DBSession, user: CurrentUser) -> ActionItem:
    """Create project action."""

    _resolve_project(db, project_id)
    if payload.activity_id:
        activity_exists = db.scalar(
            select(Activity.id).where(Activity.id == payload.activity_id, Activity.project_id == project_id)
        )
        if activity_exists is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Linked activity not found")

    action = ActionItem(project_id=project_id, created_by=user.username, **payload.model_dump())
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


@router.patch("/{action_id}", response_model=ActionOut)
def update_action(
    project_id: str,
    action_id: str,
    payload: ActionUpdate,
    db: DBSession,
    _: CurrentUser,
) -> ActionItem:
    """Patch existing action fields."""

    _resolve_project(db, project_id)
    action = db.scalar(
        select(ActionItem).where(ActionItem.id == action_id, ActionItem.project_id == project_id)
    )
    if action is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")

    patch = payload.model_dump(exclude_unset=True)
    for field, value in patch.items():
        setattr(action, field, value)
    db.commit()
    db.refresh(action)
    return action


@router.delete("/{action_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_action(project_id: str, action_id: str, db: DBSession, _: CurrentUser) -> None:
    """Delete action."""

    _resolve_project(db, project_id)
    action = db.scalar(
        select(ActionItem).where(ActionItem.id == action_id, ActionItem.project_id == project_id)
    )
    if action is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")
    db.delete(action)
    db.commit()
