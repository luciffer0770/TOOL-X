"""Server-rendered PS-ETW web UI routes."""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from openpyxl import load_workbook

from psetw_platform.core.security import create_access_token, decode_access_token, verify_password
from psetw_platform.dependencies import DBSession
from psetw_platform.models import (
    ActionItem,
    ActionStatus,
    Activity,
    ActivityStatus,
    Baseline,
    Project,
    User,
    UserRole,
)
from psetw_platform.schemas import ScenarioSimulationInput
from psetw_platform.services.analytics import (
    compute_delay_risk_rows,
    compute_dependency_health,
    compute_portfolio_metrics,
    detect_activity_anomalies,
)
from psetw_platform.services.planning import (
    compute_calendar_buckets,
    compute_gantt_rows,
    compute_material_health,
    compute_network_graph,
    compute_phase_progress,
    compute_timeline_bounds,
    simulate_scenario,
)

router = APIRouter(tags=["web-ui"])
templates = Jinja2Templates(
    directory=str(Path(__file__).resolve().parent.parent / "web" / "templates"),
)
SESSION_COOKIE_NAME = "psetw_ui_session"
DEFAULT_PAGE_SIZE = 50
ALLOWED_PAGE_SIZES = {25, 50, 100, 250, 1000}
ACTIVITY_EXPORT_COLUMNS: list[tuple[str, str]] = [
    ("Activity ID", "activity_code"),
    ("Activity Name", "activity_name"),
    ("Phase", "phase"),
    ("Sub Activity", "sub_activity"),
    ("Planned Start Date", "planned_start_date"),
    ("Planned End Date", "planned_end_date"),
    ("Planned Duration Hours", "planned_duration_hours"),
    ("Actual Start Date", "actual_start_date"),
    ("Actual End Date", "actual_end_date"),
    ("Actual Duration Hours", "actual_duration_hours"),
    ("Base Effort Hours", "base_effort_hours"),
    ("Required Materials", "required_materials"),
    ("Required Tools", "required_tools"),
    ("Dependencies", "dependencies"),
    ("Dependency Type", "dependency_type"),
    ("Priority", "priority"),
    ("Milestone", "milestone"),
    ("Assigned Manpower", "assigned_manpower"),
    ("Manpower Skill Level", "manpower_skill_level"),
    ("Resource Name", "resource_name"),
    ("Resource Department", "resource_department"),
    ("Shift Type", "shift_type"),
    ("Material Status", "material_status"),
    ("Material Ownership", "material_ownership"),
    ("Supplier / Vendor", "material_supplier"),
    ("Material Criticality", "material_criticality"),
    ("Material Required Date", "material_required_date"),
    ("Material Received Date", "material_received_date"),
    ("Material Lead Time", "material_lead_time"),
    ("Activity Status", "status"),
    ("Completion Percentage", "completion_percentage"),
    ("Risk Level", "risk_level"),
    ("Risk Score", "risk_score"),
    ("Risk Probability", "risk_probability"),
    ("Risk Impact", "risk_impact"),
    ("Mitigation Status", "risk_mitigation_status"),
    ("Risk Owner", "risk_owner"),
    ("Risk Review Date", "risk_review_date"),
    ("Delay Reason", "delay_reason"),
    ("Manual Override Duration", "manual_override_duration"),
    ("Override Reason", "override_reason"),
    ("Override Approved By", "override_approved_by"),
    ("Estimated Cost", "estimated_cost"),
    ("Actual Cost", "actual_cost"),
    ("Cost Center", "cost_center"),
    ("Last Modified By", "last_modified_by"),
    ("Last Modified Date", "last_modified_date"),
    ("Remarks", "remarks"),
]


def _parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        try:
            return datetime.fromisoformat(raw).date()
        except ValueError:
            return None


def _serialize_activity(activity: Activity) -> dict[str, object]:
    return {
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
        "material_required_date": (
            activity.material_required_date.isoformat() if activity.material_required_date else None
        ),
        "material_received_date": (
            activity.material_received_date.isoformat() if activity.material_received_date else None
        ),
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
        "last_modified_date": activity.last_modified_date.isoformat() if activity.last_modified_date else None,
        "delay_reason": activity.delay_reason,
        "remarks": activity.remarks,
    }


def _get_cookie_user(request: Request, db: DBSession) -> User | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    username = decode_access_token(token)
    if username is None:
        return None
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_active:
        return None
    return user


def _login_redirect() -> RedirectResponse:
    return RedirectResponse(url="/ui/login", status_code=303)


def _ensure_projects(db: DBSession, user: User) -> list[Project]:
    projects = list(db.scalars(select(Project).order_by(Project.updated_at.desc())).all())
    if projects:
        return projects
    project = Project(name="Project 1", created_by=user.username)
    db.add(project)
    db.commit()
    db.refresh(project)
    return [project]


def _resolve_project(projects: Iterable[Project], requested_id: str | None) -> Project:
    project_list = list(projects)
    if requested_id:
        for project in project_list:
            if project.id == requested_id:
                return project
    return next(iter(project_list))


def _base_context(
    request: Request,
    user: User,
    projects: list[Project],
    active_project: Project,
    current_path: str,
    message: str = "",
) -> dict[str, object]:
    return {
        "request": request,
        "user": user,
        "projects": projects,
        "active_project": active_project,
        "current_path": current_path,
        "message": message,
        "status_values": [status.value for status in ActivityStatus],
    }


def _normalize_header(value: object) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").replace("-", " ").split())


IMPORT_HEADER_MAP = {
    "activity id": "activity_code",
    "activityid": "activity_code",
    "activity code": "activity_code",
    "activity_code": "activity_code",
    "activity name": "activity_name",
    "activity_name": "activity_name",
    "phase": "phase",
    "sub activity": "sub_activity",
    "subactivity": "sub_activity",
    "sub_activity": "sub_activity",
    "planned start date": "planned_start_date",
    "planned_start_date": "planned_start_date",
    "planned end date": "planned_end_date",
    "planned_end_date": "planned_end_date",
    "planned duration hours": "planned_duration_hours",
    "actual start date": "actual_start_date",
    "actual end date": "actual_end_date",
    "actual duration hours": "actual_duration_hours",
    "base effort hours": "base_effort_hours",
    "baseefforthours": "base_effort_hours",
    "required materials": "required_materials",
    "required tools": "required_tools",
    "dependencies": "dependencies",
    "dependency type": "dependency_type",
    "priority": "priority",
    "milestone": "milestone",
    "assigned manpower": "assigned_manpower",
    "manpower skill level": "manpower_skill_level",
    "resource name": "resource_name",
    "resource department": "resource_department",
    "shift type": "shift_type",
    "material status": "material_status",
    "material ownership": "material_ownership",
    "supplier / vendor": "material_supplier",
    "supplier": "material_supplier",
    "material criticality": "material_criticality",
    "material required date": "material_required_date",
    "material received date": "material_received_date",
    "material lead time": "material_lead_time",
    "activity status": "status",
    "status": "status",
    "completion percentage": "completion_percentage",
    "risk level": "risk_level",
    "risk score": "risk_score",
    "risk probability": "risk_probability",
    "risk impact": "risk_impact",
    "mitigation status": "risk_mitigation_status",
    "risk mitigation status": "risk_mitigation_status",
    "risk owner": "risk_owner",
    "risk review date": "risk_review_date",
    "delay reason": "delay_reason",
    "manual override duration": "manual_override_duration",
    "override reason": "override_reason",
    "override approved by": "override_approved_by",
    "estimated cost": "estimated_cost",
    "actual cost": "actual_cost",
    "cost center": "cost_center",
    "last modified by": "last_modified_by",
    "last modified date": "last_modified_date",
    "remarks": "remarks",
}

REQUIRED_IMPORT_FIELDS = {
    "activity_code",
    "activity_name",
    "phase",
    "sub_activity",
    "base_effort_hours",
    "required_materials",
    "required_tools",
    "material_ownership",
    "material_lead_time",
    "dependencies",
}

STATUS_MAP = {status.value.lower(): status for status in ActivityStatus}


def _as_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _as_int(value: object, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        return int(float(str(value).strip()))
    except (ValueError, TypeError):
        return default


def _as_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    return _parse_date(str(value))


def _parse_dependencies(value: object) -> list[str]:
    if value is None:
        return []
    tokens = []
    for part in str(value).replace(";", ",").split(","):
        token = part.strip()
        if token:
            tokens.append(token)
    return list(dict.fromkeys(tokens))


def _coerce_status(value: object) -> ActivityStatus:
    normalized = str(value or "").strip().lower()
    return STATUS_MAP.get(normalized, ActivityStatus.not_started)


def _next_activity_code(existing_codes: set[str]) -> str:
    max_code = 0
    for code in existing_codes:
        if code.startswith("ACT-"):
            suffix = code.removeprefix("ACT-")
            if suffix.isdigit():
                max_code = max(max_code, int(suffix))
    return f"ACT-{max_code + 1:04d}"


def _activity_to_export_row(activity: Activity) -> dict[str, object]:
    row: dict[str, object] = {}
    for label, field in ACTIVITY_EXPORT_COLUMNS:
        value = getattr(activity, field)
        if isinstance(value, ActivityStatus):
            row[label] = value.value
        elif isinstance(value, list):
            row[label] = ", ".join(value)
        elif isinstance(value, date):
            row[label] = value.isoformat()
        else:
            row[label] = value
    return row


def _parse_import_rows(file_name: str, content: bytes) -> list[dict[str, object]]:
    lower_name = file_name.lower()
    if lower_name.endswith(".csv"):
        text = content.decode("utf-8-sig", errors="ignore")
        reader = csv.DictReader(io.StringIO(text))
        return [dict(row) for row in reader]
    if lower_name.endswith(".xlsx"):
        workbook = load_workbook(io.BytesIO(content), data_only=True)
        sheet = workbook.active
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(value or "").strip() for value in rows[0]]
        parsed: list[dict[str, object]] = []
        for row in rows[1:]:
            parsed.append({headers[idx]: row[idx] if idx < len(row) else "" for idx in range(len(headers))})
        return parsed
    raise ValueError("Unsupported file format. Use .xlsx or .csv")


def _apply_import_row(activity: Activity, row_values: dict[str, object]) -> None:
    for key, value in row_values.items():
        if key == "status":
            activity.status = _coerce_status(value)
        elif key in {"planned_start_date", "planned_end_date", "actual_start_date", "actual_end_date", "material_required_date", "material_received_date", "risk_review_date", "last_modified_date"}:
            setattr(activity, key, _as_date(value))
        elif key in {
            "completion_percentage",
            "planned_duration_hours",
            "actual_duration_hours",
            "base_effort_hours",
            "assigned_manpower",
            "material_lead_time",
            "risk_score",
            "risk_probability",
            "risk_impact",
            "manual_override_duration",
            "estimated_cost",
            "actual_cost",
        }:
            setattr(activity, key, _as_int(value))
        elif key == "dependencies":
            setattr(activity, key, _parse_dependencies(value))
        else:
            setattr(activity, key, _as_text(value))


@router.get("/ui", include_in_schema=False)
def ui_home(request: Request, db: DBSession) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    return RedirectResponse(url="/ui/dashboard", status_code=303)


@router.get("/ui/login", response_class=HTMLResponse, include_in_schema=False)
def ui_login_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        "login.html",
        {"request": request, "error": "", "title": "PS-ETW Login"},
    )


@router.post("/ui/login", response_class=HTMLResponse, include_in_schema=False)
def ui_login_action(
    request: Request,
    db: DBSession,
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
    remember_me: Annotated[bool, Form()] = False,
) -> Response:
    user = db.scalar(select(User).where(User.username == username.strip().lower()))
    if user is None or not verify_password(password, user.password_hash):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid credentials.", "title": "PS-ETW Login"},
            status_code=401,
        )

    expires_minutes = 60 * 24 * 30 if remember_me else 60 * 8
    token = create_access_token(subject=user.username, expires_minutes=expires_minutes)
    response = RedirectResponse(url="/ui/dashboard", status_code=303)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=expires_minutes * 60,
        httponly=True,
        samesite="lax",
    )
    return response


@router.post("/ui/logout", include_in_schema=False)
def ui_logout() -> RedirectResponse:
    response = RedirectResponse(url="/ui/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return response


@router.get("/ui/dashboard", response_class=HTMLResponse, include_in_schema=False)
def ui_dashboard(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()

    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(
        db.scalars(
            select(Activity)
            .where(Activity.project_id == active_project.id)
            .order_by(Activity.created_at.asc())
        ).all()
    )
    actions = list(db.scalars(select(ActionItem).where(ActionItem.project_id == active_project.id)).all())

    anomalies = detect_activity_anomalies(activities)
    severity_counts = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}
    for anomaly in anomalies:
        severity = anomaly.severity if anomaly.severity in severity_counts else "Low"
        severity_counts[severity] += 1

    open_actions = [action for action in actions if action.status != ActionStatus.closed]
    overdue_actions = [
        action for action in open_actions if action.due_date is not None and action.due_date < date.today()
    ]

    context = _base_context(request, user, projects, active_project, "/ui/dashboard")
    context.update(
        {
            "title": "Dashboard",
            "portfolio_metrics": compute_portfolio_metrics(activities),
            "phase_progress": compute_phase_progress(activities),
            "top_risks": compute_delay_risk_rows(activities)[:8],
            "dependency_health": compute_dependency_health(activities),
            "anomaly_counts": severity_counts,
            "open_action_count": len(open_actions),
            "overdue_action_count": len(overdue_actions),
        }
    )
    return templates.TemplateResponse("dashboard.html", context)


@router.get("/ui/activities", response_class=HTMLResponse, include_in_schema=False)
def ui_activities(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
    message: str = "",
    search: str = "",
    status_filter: str = "",
    phase_filter: str = "",
    page: int = 1,
    page_size: int = DEFAULT_PAGE_SIZE,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(
        db.scalars(
            select(Activity)
            .where(Activity.project_id == active_project.id)
            .order_by(Activity.created_at.asc())
        ).all()
    )
    status_options = sorted({activity.status.value for activity in activities})
    phase_options = sorted({activity.phase for activity in activities if activity.phase})

    normalized_search = search.strip().lower()
    normalized_status = status_filter.strip().lower()
    normalized_phase = phase_filter.strip().lower()
    filtered = []
    for activity in activities:
        if normalized_status and activity.status.value.lower() != normalized_status:
            continue
        if normalized_phase and activity.phase.strip().lower() != normalized_phase:
            continue
        if normalized_search:
            haystack = " ".join(
                [
                    activity.activity_code,
                    activity.activity_name,
                    activity.phase,
                    activity.sub_activity,
                    activity.required_materials,
                    activity.required_tools,
                    activity.delay_reason,
                    activity.remarks,
                ]
            ).lower()
            if normalized_search not in haystack:
                continue
        filtered.append(activity)

    if page_size not in ALLOWED_PAGE_SIZES:
        page_size = DEFAULT_PAGE_SIZE
    total_count = len(activities)
    filtered_count = len(filtered)
    total_pages = max(1, (filtered_count + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))
    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paged_activities = filtered[start_idx:end_idx]

    context = _base_context(request, user, projects, active_project, "/ui/activities", message)
    context.update(
        {
            "title": "Activities",
            "activities": paged_activities,
            "total_count": total_count,
            "filtered_count": filtered_count,
            "status_filter": status_filter,
            "phase_filter": phase_filter,
            "search": search,
            "status_options": status_options,
            "phase_options": phase_options,
            "page_size": page_size,
            "page": page,
            "total_pages": total_pages,
            "start_idx": start_idx,
            "end_idx": min(end_idx, filtered_count),
            "allowed_page_sizes": sorted(ALLOWED_PAGE_SIZES),
        }
    )
    return templates.TemplateResponse("activities.html", context)


def _activities_redirect(project_id: str, message: str = "") -> RedirectResponse:
    url = f"/ui/activities?project_id={project_id}"
    if message:
        url += f"&message={message}"
    return RedirectResponse(url=url, status_code=303)


@router.post("/ui/projects/{project_id}/activities", include_in_schema=False)
def ui_create_activity(
    request: Request,
    db: DBSession,
    project_id: str,
    activity_code: Annotated[str, Form()],
    activity_name: Annotated[str, Form()],
    phase: Annotated[str, Form()] = "",
    status: Annotated[str, Form()] = ActivityStatus.not_started.value,
    planned_start_date: Annotated[str, Form()] = "",
    planned_end_date: Annotated[str, Form()] = "",
    planned_duration_hours: Annotated[int, Form()] = 0,
    completion_percentage: Annotated[int, Form()] = 0,
    sub_activity: Annotated[str, Form()] = "",
    base_effort_hours: Annotated[int, Form()] = 0,
    required_materials: Annotated[str, Form()] = "",
    required_tools: Annotated[str, Form()] = "",
    dependencies: Annotated[str, Form()] = "",
    dependency_type: Annotated[str, Form()] = "FS",
    priority: Annotated[str, Form()] = "Medium",
    milestone: Annotated[str, Form()] = "",
    assigned_manpower: Annotated[int, Form()] = 1,
    manpower_skill_level: Annotated[str, Form()] = "",
    resource_name: Annotated[str, Form()] = "",
    resource_department: Annotated[str, Form()] = "",
    shift_type: Annotated[str, Form()] = "",
    material_status: Annotated[str, Form()] = "Not Ordered",
    material_ownership: Annotated[str, Form()] = "Mechanical",
    material_supplier: Annotated[str, Form()] = "",
    material_criticality: Annotated[str, Form()] = "Medium",
    material_required_date: Annotated[str, Form()] = "",
    material_received_date: Annotated[str, Form()] = "",
    material_lead_time: Annotated[int, Form()] = 0,
    risk_level: Annotated[str, Form()] = "Low",
    risk_score: Annotated[int, Form()] = 0,
    risk_probability: Annotated[int, Form()] = 3,
    risk_impact: Annotated[int, Form()] = 3,
    risk_mitigation_status: Annotated[str, Form()] = "Planned",
    risk_owner: Annotated[str, Form()] = "",
    risk_review_date: Annotated[str, Form()] = "",
    manual_override_duration: Annotated[int, Form()] = 0,
    override_reason: Annotated[str, Form()] = "",
    override_approved_by: Annotated[str, Form()] = "",
    estimated_cost: Annotated[int, Form()] = 0,
    actual_cost: Annotated[int, Form()] = 0,
    cost_center: Annotated[str, Form()] = "",
    last_modified_by: Annotated[str, Form()] = "",
    last_modified_date: Annotated[str, Form()] = "",
    delay_reason: Annotated[str, Form()] = "",
    remarks: Annotated[str, Form()] = "",
) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if user.role not in {UserRole.planner, UserRole.management}:
        return _activities_redirect(project_id, "Only planning or management can create activities.")

    existing = db.scalar(
        select(Activity).where(Activity.project_id == project_id, Activity.activity_code == activity_code.strip())
    )
    if existing is not None:
        return _activities_redirect(project_id, "Activity code already exists.")

    try:
        status_enum = ActivityStatus(status)
    except ValueError:
        status_enum = ActivityStatus.not_started

    new_activity = Activity(
        project_id=project_id,
        activity_code=activity_code.strip(),
        activity_name=activity_name.strip() or "Unnamed",
        phase=phase.strip(),
        sub_activity=sub_activity.strip(),
        status=status_enum,
        completion_percentage=max(0, min(100, completion_percentage)),
        planned_start_date=_parse_date(planned_start_date),
        planned_end_date=_parse_date(planned_end_date),
        planned_duration_hours=max(0, planned_duration_hours),
        base_effort_hours=max(0, base_effort_hours),
        required_materials=required_materials.strip(),
        required_tools=required_tools.strip(),
        dependencies=_parse_dependencies(dependencies),
        dependency_type=dependency_type.strip() or "FS",
        priority=priority.strip() or "Medium",
        milestone=milestone.strip(),
        assigned_manpower=max(1, assigned_manpower),
        manpower_skill_level=manpower_skill_level.strip(),
        resource_name=resource_name.strip(),
        resource_department=resource_department.strip(),
        shift_type=shift_type.strip(),
        material_status=material_status.strip() or "Not Ordered",
        material_ownership=material_ownership.strip() or "Mechanical",
        material_supplier=material_supplier.strip(),
        material_criticality=material_criticality.strip() or "Medium",
        material_required_date=_parse_date(material_required_date),
        material_received_date=_parse_date(material_received_date),
        material_lead_time=max(0, material_lead_time),
        risk_level=risk_level.strip() or "Low",
        risk_score=max(0, min(100, risk_score)),
        risk_probability=max(1, min(5, risk_probability)),
        risk_impact=max(1, min(5, risk_impact)),
        risk_mitigation_status=risk_mitigation_status.strip() or "Planned",
        risk_owner=risk_owner.strip(),
        risk_review_date=_parse_date(risk_review_date),
        manual_override_duration=max(0, manual_override_duration),
        override_reason=override_reason.strip(),
        override_approved_by=override_approved_by.strip(),
        estimated_cost=max(0, estimated_cost),
        actual_cost=max(0, actual_cost),
        cost_center=cost_center.strip(),
        last_modified_by=last_modified_by.strip() or user.username,
        last_modified_date=_parse_date(last_modified_date) or date.today(),
        delay_reason=delay_reason.strip(),
        remarks=remarks.strip(),
    )
    db.add(new_activity)
    db.commit()
    return _activities_redirect(project_id, "Activity created.")


@router.post("/ui/projects/{project_id}/activities/{activity_id}/progress", include_in_schema=False)
def ui_update_activity_progress(
    request: Request,
    db: DBSession,
    project_id: str,
    activity_id: str,
    status: Annotated[str, Form()] = ActivityStatus.in_progress.value,
    completion_percentage: Annotated[int, Form()] = 0,
    risk_score: Annotated[int, Form()] = 0,
    material_status: Annotated[str, Form()] = "",
    material_ownership: Annotated[str, Form()] = "",
    delay_reason: Annotated[str, Form()] = "",
    remarks: Annotated[str, Form()] = "",
) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()

    activity = db.scalar(
        select(Activity).where(Activity.project_id == project_id, Activity.id == activity_id)
    )
    if activity is None:
        return _activities_redirect(project_id, "Activity not found.")
    try:
        activity.status = ActivityStatus(status)
    except ValueError:
        pass
    activity.completion_percentage = max(0, min(100, completion_percentage))
    activity.risk_score = max(0, min(100, risk_score))
    if material_status.strip():
        activity.material_status = material_status.strip()
    if material_ownership.strip():
        activity.material_ownership = material_ownership.strip()
    activity.delay_reason = delay_reason.strip()
    activity.remarks = remarks.strip()
    activity.last_modified_by = user.username
    activity.last_modified_date = date.today()
    db.commit()
    return _activities_redirect(project_id, "Activity updated.")


@router.post("/ui/projects/{project_id}/activities/{activity_id}/delete", include_in_schema=False)
def ui_delete_activity(request: Request, db: DBSession, project_id: str, activity_id: str) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if user.role not in {UserRole.planner, UserRole.management}:
        return _activities_redirect(project_id, "Only planning or management can delete activities.")
    activity = db.scalar(
        select(Activity).where(Activity.project_id == project_id, Activity.id == activity_id)
    )
    if activity is not None:
        db.delete(activity)
        db.commit()
    return _activities_redirect(project_id, "Activity deleted.")


@router.post("/ui/projects/{project_id}/activities/bulk-status", include_in_schema=False)
def ui_bulk_status_update(
    request: Request,
    db: DBSession,
    project_id: str,
    selected_ids: Annotated[list[str], Form()],
    bulk_status: Annotated[str, Form()],
) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if not selected_ids:
        return _activities_redirect(project_id, "No rows selected.")
    try:
        status_value = ActivityStatus(bulk_status)
    except ValueError:
        return _activities_redirect(project_id, "Invalid status selected.")
    rows = list(
        db.scalars(
            select(Activity).where(Activity.project_id == project_id, Activity.id.in_(selected_ids))
        ).all()
    )
    for row in rows:
        row.status = status_value
        row.last_modified_by = user.username
        row.last_modified_date = date.today()
    db.commit()
    return _activities_redirect(project_id, f"Updated status for {len(rows)} activities.")


@router.post("/ui/projects/{project_id}/activities/bulk-delete", include_in_schema=False)
def ui_bulk_delete(
    request: Request,
    db: DBSession,
    project_id: str,
    selected_ids: Annotated[list[str], Form()],
) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if user.role not in {UserRole.planner, UserRole.management}:
        return _activities_redirect(project_id, "Only planning or management can delete activities.")
    if not selected_ids:
        return _activities_redirect(project_id, "No rows selected.")
    rows = list(
        db.scalars(
            select(Activity).where(Activity.project_id == project_id, Activity.id.in_(selected_ids))
        ).all()
    )
    for row in rows:
        db.delete(row)
    db.commit()
    return _activities_redirect(project_id, f"Deleted {len(rows)} activities.")


@router.post("/ui/projects/{project_id}/activities/import", include_in_schema=False)
async def ui_import_activities(
    request: Request,
    db: DBSession,
    project_id: str,
    file: UploadFile = File(...),
    merge_strategy: Annotated[str, Form()] = "merge",
) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if user.role not in {UserRole.planner, UserRole.management}:
        return _activities_redirect(project_id, "Only planning or management can import activities.")
    if not file.filename:
        return _activities_redirect(project_id, "Please select a file to import.")

    content = await file.read()
    try:
        raw_rows = _parse_import_rows(file.filename, content)
    except ValueError as exc:
        return _activities_redirect(project_id, str(exc))

    if not raw_rows:
        return _activities_redirect(project_id, "No rows found in uploaded file.")

    normalized_rows: list[dict[str, object]] = []
    for raw_row in raw_rows:
        mapped: dict[str, object] = {}
        for header, value in raw_row.items():
            key = IMPORT_HEADER_MAP.get(_normalize_header(header))
            if key:
                mapped[key] = value
        normalized_rows.append(mapped)

    present_fields = {key for row in normalized_rows for key in row}
    missing_required = sorted(REQUIRED_IMPORT_FIELDS - present_fields)
    if missing_required:
        return _activities_redirect(
            project_id,
            "Missing required import columns: " + ", ".join(missing_required),
        )

    existing = list(db.scalars(select(Activity).where(Activity.project_id == project_id)).all())
    existing_by_code = {activity.activity_code: activity for activity in existing}
    existing_codes = {activity.activity_code for activity in existing}

    if merge_strategy == "replace":
        for row in existing:
            db.delete(row)
        db.flush()
        existing_by_code = {}
        existing_codes = set()

    created = 0
    updated = 0
    for row in normalized_rows:
        code = _as_text(row.get("activity_code"))
        if not code:
            code = _next_activity_code(existing_codes)
        target = existing_by_code.get(code)
        if target is None:
            target = Activity(
                project_id=project_id,
                activity_code=code,
                activity_name=_as_text(row.get("activity_name")) or "Unnamed",
            )
            db.add(target)
            existing_by_code[code] = target
            existing_codes.add(code)
            created += 1
        else:
            updated += 1
        _apply_import_row(target, row)
        target.activity_code = code
        if not target.activity_name:
            target.activity_name = "Unnamed"
        target.last_modified_by = user.username
        target.last_modified_date = date.today()

    db.commit()
    return _activities_redirect(project_id, f"Import complete: {created} created, {updated} updated.")


def _build_export_filename(prefix: str, suffix: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{stamp}.{suffix}"


@router.get("/ui/projects/{project_id}/activities/export.csv", include_in_schema=False)
def ui_export_activities_csv(request: Request, db: DBSession, project_id: str) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    activities = list(
        db.scalars(select(Activity).where(Activity.project_id == project_id).order_by(Activity.created_at.asc())).all()
    )
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=[label for label, _ in ACTIVITY_EXPORT_COLUMNS])
    writer.writeheader()
    for activity in activities:
        writer.writerow(_activity_to_export_row(activity))
    content = buffer.getvalue().encode("utf-8")
    headers = {"Content-Disposition": f"attachment; filename={_build_export_filename('activities', 'csv')}"}
    return Response(content=content, media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/ui/projects/{project_id}/activities/export.json", include_in_schema=False)
def ui_export_activities_json(request: Request, db: DBSession, project_id: str) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    activities = list(
        db.scalars(select(Activity).where(Activity.project_id == project_id).order_by(Activity.created_at.asc())).all()
    )
    payload = [_activity_to_export_row(activity) for activity in activities]
    headers = {"Content-Disposition": f"attachment; filename={_build_export_filename('activities', 'json')}"}
    return Response(content=json.dumps(payload, indent=2), media_type="application/json", headers=headers)


@router.get("/ui/projects/{project_id}/activities/export.xlsx", include_in_schema=False)
def ui_export_activities_xlsx(request: Request, db: DBSession, project_id: str) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    activities = list(
        db.scalars(select(Activity).where(Activity.project_id == project_id).order_by(Activity.created_at.asc())).all()
    )

    workbook_buffer = io.BytesIO()
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Activities"
    headers = [label for label, _ in ACTIVITY_EXPORT_COLUMNS]
    sheet.append(headers)
    for activity in activities:
        row = _activity_to_export_row(activity)
        sheet.append([row.get(header, "") for header in headers])
    workbook.save(workbook_buffer)
    workbook_buffer.seek(0)
    headers_map = {"Content-Disposition": f"attachment; filename={_build_export_filename('activities', 'xlsx')}"}
    return StreamingResponse(
        workbook_buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers_map,
    )


def _render_planning_page(
    request: Request,
    db: DBSession,
    project_id: str | None,
    template_name: str,
    current_path: str,
    title: str,
    extra_context: dict[str, object],
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    context = _base_context(request, user, projects, active_project, current_path)
    context.update(extra_context)
    context["title"] = title
    return templates.TemplateResponse(template_name, context)


@router.get("/ui/gantt", response_class=HTMLResponse, include_in_schema=False)
def ui_gantt(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
    phase: str | None = None,
    status_filter: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())

    status_value: ActivityStatus | None = None
    if status_filter:
        try:
            status_value = ActivityStatus(status_filter)
        except ValueError:
            status_value = None
    rows = compute_gantt_rows(activities, phase_filter=phase, status_filter=status_value)
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "gantt.html",
        "/ui/gantt",
        "Gantt",
        {
            "rows": rows,
            "phase_filter": phase or "",
            "status_filter": status_filter or "",
            "timeline_bounds": compute_timeline_bounds(activities),
        },
    )


@router.get("/ui/calendar", response_class=HTMLResponse, include_in_schema=False)
def ui_calendar(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
    month: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())

    if month:
        month_date = datetime.strptime(f"{month}-01", "%Y-%m-%d").date()
    else:
        today = date.today()
        month_date = date(today.year, today.month, 1)
    next_month = date(month_date.year + int(month_date.month == 12), (month_date.month % 12) + 1, 1)
    month_end = next_month - timedelta(days=1)
    calendar_rows = compute_calendar_buckets(activities, month_date, month_end)

    prev_month = month_date - timedelta(days=1)
    next_month_cursor = month_end + timedelta(days=1)
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "calendar.html",
        "/ui/calendar",
        "Calendar",
        {
            "month_cursor": month_date,
            "prev_month": f"{prev_month.year}-{prev_month.month:02d}",
            "next_month": f"{next_month_cursor.year}-{next_month_cursor.month:02d}",
            "calendar_rows": calendar_rows,
        },
    )


@router.get("/ui/network", response_class=HTMLResponse, include_in_schema=False)
def ui_network(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())
    graph = compute_network_graph(activities)
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "network.html",
        "/ui/network",
        "Network",
        {"graph": graph},
    )


@router.get("/ui/risk-register", response_class=HTMLResponse, include_in_schema=False)
def ui_risk_register(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())
    risk_rows = compute_delay_risk_rows(activities)
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "risk_register.html",
        "/ui/risk-register",
        "Risk Register",
        {"risk_rows": risk_rows},
    )


@router.get("/ui/anomaly-center", response_class=HTMLResponse, include_in_schema=False)
def ui_anomaly_center(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())
    anomalies = detect_activity_anomalies(activities)
    baselines = list(
        db.scalars(
            select(Baseline)
            .where(Baseline.project_id == active_project.id)
            .order_by(Baseline.created_at.desc())
        ).all()
    )
    actions = list(
        db.scalars(
            select(ActionItem)
            .where(ActionItem.project_id == active_project.id)
            .order_by(ActionItem.updated_at.desc())
        ).all()
    )
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "anomaly_center.html",
        "/ui/anomaly-center",
        "Anomaly Center",
        {"anomalies": anomalies, "baselines": baselines, "actions": actions},
    )


@router.post("/ui/projects/{project_id}/baselines", include_in_schema=False)
def ui_create_baseline(
    request: Request,
    db: DBSession,
    project_id: str,
    name: Annotated[str, Form()] = "",
) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if user.role not in {UserRole.planner, UserRole.management}:
        return RedirectResponse(
            url=f"/ui/anomaly-center?project_id={project_id}&message=Only planning or management can lock baselines.",
            status_code=303,
        )
    activities = list(db.scalars(select(Activity).where(Activity.project_id == project_id)).all())
    baseline = Baseline(
        project_id=project_id,
        name=name.strip() or f"Baseline {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        snapshot={"activities": [_serialize_activity(activity) for activity in activities]},
        created_by=user.username,
    )
    db.add(baseline)
    db.commit()
    return RedirectResponse(url=f"/ui/anomaly-center?project_id={project_id}", status_code=303)


@router.get("/ui/materials", response_class=HTMLResponse, include_in_schema=False)
def ui_materials(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())
    health = compute_material_health(activities)
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "materials.html",
        "/ui/materials",
        "Materials",
        {"health": health, "activities": activities},
    )


@router.get("/ui/intelligence", response_class=HTMLResponse, include_in_schema=False)
def ui_intelligence(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "intelligence.html",
        "/ui/intelligence",
        "Intelligence",
        {"simulation_result": None, "activity_count": len(activities)},
    )


@router.post("/ui/intelligence/simulate", response_class=HTMLResponse, include_in_schema=False)
def ui_intelligence_simulate(
    request: Request,
    db: DBSession,
    project_id: Annotated[str, Form()],
    manpower_boost_pct: Annotated[float, Form()] = 0.0,
    overtime_hours_per_day: Annotated[float, Form()] = 0.0,
    lead_time_reduction_pct: Annotated[float, Form()] = 0.0,
) -> Response:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())
    scenario = ScenarioSimulationInput(
        manpower_boost_pct=manpower_boost_pct,
        overtime_hours_per_day=overtime_hours_per_day,
        lead_time_reduction_pct=lead_time_reduction_pct,
    )
    result = simulate_scenario(activities, scenario)
    return _render_planning_page(
        request,
        db,
        active_project.id,
        "intelligence.html",
        "/ui/intelligence",
        "Intelligence",
        {
            "simulation_result": result,
            "scenario": scenario,
            "activity_count": len(activities),
        },
    )
