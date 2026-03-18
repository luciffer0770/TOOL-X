"""Baseline snapshot endpoints."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select

from psetw_platform.dependencies import CurrentUser, DBSession, require_roles
from psetw_platform.models import Activity, ActivityStatus, Baseline, Project, UserRole
from psetw_platform.schemas import BaselineCreate, BaselineOut

router = APIRouter(prefix="/projects/{project_id}/baselines", tags=["baselines"])


def _resolve_project(db: DBSession, project_id: str) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id))
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _parse_iso_date(value: object) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    return date.fromisoformat(value)


@router.get("", response_model=list[BaselineOut])
def list_baselines(project_id: str, db: DBSession, _: CurrentUser) -> list[Baseline]:
    """List all baseline snapshots for a project."""

    _resolve_project(db, project_id)
    stmt = select(Baseline).where(Baseline.project_id == project_id).order_by(Baseline.created_at.desc())
    return list(db.scalars(stmt).all())


@router.post(
    "",
    response_model=BaselineOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def create_baseline(project_id: str, payload: BaselineCreate, db: DBSession, user: CurrentUser) -> Baseline:
    """Create immutable baseline from current project activities."""

    _resolve_project(db, project_id)
    activities = list(
        db.scalars(select(Activity).where(Activity.project_id == project_id).order_by(Activity.created_at.asc())).all()
    )
    snapshot = {
        "activities": [
            {
                "activity_code": activity.activity_code,
                "activity_name": activity.activity_name,
                "phase": activity.phase,
                "status": activity.status.value,
                "completion_percentage": activity.completion_percentage,
                "planned_start_date": activity.planned_start_date.isoformat() if activity.planned_start_date else None,
                "planned_end_date": activity.planned_end_date.isoformat() if activity.planned_end_date else None,
                "actual_start_date": activity.actual_start_date.isoformat() if activity.actual_start_date else None,
                "actual_end_date": activity.actual_end_date.isoformat() if activity.actual_end_date else None,
                "base_effort_hours": activity.base_effort_hours,
                "dependencies": activity.dependencies,
                "material_status": activity.material_status,
                "material_ownership": activity.material_ownership,
                "risk_score": activity.risk_score,
                "delay_reason": activity.delay_reason,
                "remarks": activity.remarks,
            }
            for activity in activities
        ]
    }
    baseline = Baseline(
        project_id=project_id,
        name=payload.name.strip(),
        snapshot=snapshot,
        created_by=user.username,
    )
    db.add(baseline)
    db.commit()
    db.refresh(baseline)
    return baseline


@router.post(
    "/{baseline_id}/restore",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_roles(UserRole.planner, UserRole.management))],
)
def restore_baseline(project_id: str, baseline_id: str, db: DBSession, _: CurrentUser) -> dict[str, object]:
    """Restore project activities to a selected baseline snapshot."""

    _resolve_project(db, project_id)
    baseline = db.scalar(
        select(Baseline).where(Baseline.project_id == project_id, Baseline.id == baseline_id)
    )
    if baseline is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Baseline not found")

    activities_snapshot = baseline.snapshot.get("activities")
    if not isinstance(activities_snapshot, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid baseline snapshot")

    db.execute(delete(Activity).where(Activity.project_id == project_id))
    for row in activities_snapshot:
        if not isinstance(row, dict):
            continue
        status_raw = row.get("status", ActivityStatus.not_started.value)
        try:
            status = ActivityStatus(status_raw)
        except ValueError:
            status = ActivityStatus.not_started
        db.add(
            Activity(
                project_id=project_id,
                activity_code=str(row.get("activity_code", "")).strip(),
                activity_name=str(row.get("activity_name", "")).strip() or "Unnamed",
                phase=str(row.get("phase", "")).strip(),
                status=status,
                completion_percentage=int(row.get("completion_percentage", 0)),
                planned_start_date=_parse_iso_date(row.get("planned_start_date")),
                planned_end_date=_parse_iso_date(row.get("planned_end_date")),
                actual_start_date=_parse_iso_date(row.get("actual_start_date")),
                actual_end_date=_parse_iso_date(row.get("actual_end_date")),
                base_effort_hours=int(row.get("base_effort_hours", 0)),
                dependencies=row.get("dependencies", []),
                material_status=str(row.get("material_status", "Not Ordered")),
                material_ownership=str(row.get("material_ownership", "Mechanical")),
                risk_score=int(row.get("risk_score", 0)),
                delay_reason=str(row.get("delay_reason", "")),
                remarks=str(row.get("remarks", "")),
            )
        )
    db.commit()
    return {"restored": True, "baseline_id": baseline.id, "activity_count": len(activities_snapshot)}
