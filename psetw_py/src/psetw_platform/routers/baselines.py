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
                "sub_activity": activity.sub_activity,
                "status": activity.status.value,
                "completion_percentage": activity.completion_percentage,
                "planned_start_date": activity.planned_start_date.isoformat() if activity.planned_start_date else None,
                "planned_end_date": activity.planned_end_date.isoformat() if activity.planned_end_date else None,
                "planned_duration_hours": activity.planned_duration_hours,
                "actual_start_date": activity.actual_start_date.isoformat() if activity.actual_start_date else None,
                "actual_end_date": activity.actual_end_date.isoformat() if activity.actual_end_date else None,
                "actual_duration_hours": activity.actual_duration_hours,
                "base_effort_hours": activity.base_effort_hours,
                "required_materials": activity.required_materials,
                "required_tools": activity.required_tools,
                "dependencies": activity.dependencies,
                "dependency_type": activity.dependency_type,
                "priority": activity.priority,
                "milestone": activity.milestone,
                "assigned_manpower": activity.assigned_manpower,
                "manpower_skill_level": activity.manpower_skill_level,
                "resource_name": activity.resource_name,
                "resource_department": activity.resource_department,
                "shift_type": activity.shift_type,
                "material_status": activity.material_status,
                "material_ownership": activity.material_ownership,
                "material_supplier": activity.material_supplier,
                "material_criticality": activity.material_criticality,
                "material_required_date": activity.material_required_date.isoformat()
                if activity.material_required_date
                else None,
                "material_received_date": activity.material_received_date.isoformat()
                if activity.material_received_date
                else None,
                "material_lead_time": activity.material_lead_time,
                "risk_level": activity.risk_level,
                "risk_score": activity.risk_score,
                "risk_probability": activity.risk_probability,
                "risk_impact": activity.risk_impact,
                "risk_mitigation_status": activity.risk_mitigation_status,
                "risk_owner": activity.risk_owner,
                "risk_review_date": activity.risk_review_date.isoformat() if activity.risk_review_date else None,
                "manual_override_duration": activity.manual_override_duration,
                "override_reason": activity.override_reason,
                "override_approved_by": activity.override_approved_by,
                "estimated_cost": activity.estimated_cost,
                "actual_cost": activity.actual_cost,
                "cost_center": activity.cost_center,
                "last_modified_by": activity.last_modified_by,
                "last_modified_date": activity.last_modified_date.isoformat()
                if activity.last_modified_date
                else None,
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
                sub_activity=str(row.get("sub_activity", "")).strip(),
                status=status,
                completion_percentage=int(row.get("completion_percentage", 0)),
                planned_start_date=_parse_iso_date(row.get("planned_start_date")),
                planned_end_date=_parse_iso_date(row.get("planned_end_date")),
                planned_duration_hours=int(row.get("planned_duration_hours", 0)),
                actual_start_date=_parse_iso_date(row.get("actual_start_date")),
                actual_end_date=_parse_iso_date(row.get("actual_end_date")),
                actual_duration_hours=int(row.get("actual_duration_hours", 0)),
                base_effort_hours=int(row.get("base_effort_hours", 0)),
                required_materials=str(row.get("required_materials", "")),
                required_tools=str(row.get("required_tools", "")),
                dependencies=row.get("dependencies", []),
                dependency_type=str(row.get("dependency_type", "FS")),
                priority=str(row.get("priority", "Medium")),
                milestone=str(row.get("milestone", "")),
                assigned_manpower=int(row.get("assigned_manpower", 1)),
                manpower_skill_level=str(row.get("manpower_skill_level", "")),
                resource_name=str(row.get("resource_name", "")),
                resource_department=str(row.get("resource_department", "")),
                shift_type=str(row.get("shift_type", "")),
                material_status=str(row.get("material_status", "Not Ordered")),
                material_ownership=str(row.get("material_ownership", "Mechanical")),
                material_supplier=str(row.get("material_supplier", "")),
                material_criticality=str(row.get("material_criticality", "Medium")),
                material_required_date=_parse_iso_date(row.get("material_required_date")),
                material_received_date=_parse_iso_date(row.get("material_received_date")),
                material_lead_time=int(row.get("material_lead_time", 0)),
                risk_level=str(row.get("risk_level", "Low")),
                risk_score=int(row.get("risk_score", 0)),
                risk_probability=int(row.get("risk_probability", 3)),
                risk_impact=int(row.get("risk_impact", 3)),
                risk_mitigation_status=str(row.get("risk_mitigation_status", "Planned")),
                risk_owner=str(row.get("risk_owner", "")),
                risk_review_date=_parse_iso_date(row.get("risk_review_date")),
                manual_override_duration=int(row.get("manual_override_duration", 0)),
                override_reason=str(row.get("override_reason", "")),
                override_approved_by=str(row.get("override_approved_by", "")),
                estimated_cost=int(row.get("estimated_cost", 0)),
                actual_cost=int(row.get("actual_cost", 0)),
                cost_center=str(row.get("cost_center", "")),
                last_modified_by=str(row.get("last_modified_by", "")),
                last_modified_date=_parse_iso_date(row.get("last_modified_date")),
                delay_reason=str(row.get("delay_reason", "")),
                remarks=str(row.get("remarks", "")),
            )
        )
    db.commit()
    return {"restored": True, "baseline_id": baseline.id, "activity_count": len(activities_snapshot)}
