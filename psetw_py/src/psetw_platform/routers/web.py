"""Server-rendered PS-ETW web UI routes."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select

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
TOKEN_COOKIE_NAME = "psetw_ui_token"


def _parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    return date.fromisoformat(raw)


def _serialize_activity(activity: Activity) -> dict[str, object]:
    return {
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
        "dependency_type": activity.dependency_type,
        "priority": activity.priority,
        "assigned_manpower": activity.assigned_manpower,
        "material_status": activity.material_status,
        "material_ownership": activity.material_ownership,
        "material_criticality": activity.material_criticality,
        "material_required_date": activity.material_required_date.isoformat() if activity.material_required_date else None,
        "material_received_date": activity.material_received_date.isoformat() if activity.material_received_date else None,
        "material_lead_time": activity.material_lead_time,
        "risk_score": activity.risk_score,
        "risk_probability": activity.risk_probability,
        "risk_impact": activity.risk_impact,
        "risk_mitigation_status": activity.risk_mitigation_status,
        "risk_owner": activity.risk_owner,
        "risk_review_date": activity.risk_review_date.isoformat() if activity.risk_review_date else None,
        "estimated_cost": activity.estimated_cost,
        "actual_cost": activity.actual_cost,
        "delay_reason": activity.delay_reason,
        "remarks": activity.remarks,
    }


def _get_cookie_user(request: Request, db: DBSession) -> User | None:
    token = request.cookies.get(TOKEN_COOKIE_NAME)
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
    if requested_id:
        for project in projects:
            if project.id == requested_id:
                return project
    return list(projects)[0]


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
) -> HTMLResponse | RedirectResponse:
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
        TOKEN_COOKIE_NAME,
        token,
        max_age=expires_minutes * 60,
        httponly=True,
        samesite="lax",
    )
    return response


@router.post("/ui/logout", include_in_schema=False)
def ui_logout() -> RedirectResponse:
    response = RedirectResponse(url="/ui/login", status_code=303)
    response.delete_cookie(TOKEN_COOKIE_NAME)
    return response


@router.get("/ui/dashboard", response_class=HTMLResponse, include_in_schema=False)
def ui_dashboard(
    request: Request,
    db: DBSession,
    project_id: str | None = None,
) -> HTMLResponse | RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()

    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(
        db.scalars(select(Activity).where(Activity.project_id == active_project.id).order_by(Activity.created_at.asc())).all()
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
) -> HTMLResponse | RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(
        db.scalars(select(Activity).where(Activity.project_id == active_project.id).order_by(Activity.created_at.asc())).all()
    )
    context = _base_context(request, user, projects, active_project, "/ui/activities", message)
    context.update(
        {
            "title": "Activities",
            "activities": activities,
        }
    )
    return templates.TemplateResponse("activities.html", context)


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
    completion_percentage: Annotated[int, Form()] = 0,
    base_effort_hours: Annotated[int, Form()] = 0,
    dependencies: Annotated[str, Form()] = "",
    risk_score: Annotated[int, Form()] = 0,
) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if user.role not in {UserRole.planner, UserRole.management}:
        return RedirectResponse(
            url=f"/ui/activities?project_id={project_id}&message=Only planning or management can create activities.",
            status_code=303,
        )

    existing = db.scalar(
        select(Activity).where(Activity.project_id == project_id, Activity.activity_code == activity_code.strip())
    )
    if existing is not None:
        return RedirectResponse(
            url=f"/ui/activities?project_id={project_id}&message=Activity code already exists.",
            status_code=303,
        )

    try:
        status_enum = ActivityStatus(status)
    except ValueError:
        status_enum = ActivityStatus.not_started

    new_activity = Activity(
        project_id=project_id,
        activity_code=activity_code.strip(),
        activity_name=activity_name.strip() or "Unnamed",
        phase=phase.strip(),
        status=status_enum,
        completion_percentage=max(0, min(100, completion_percentage)),
        planned_start_date=_parse_date(planned_start_date),
        planned_end_date=_parse_date(planned_end_date),
        base_effort_hours=max(0, base_effort_hours),
        dependencies=[token.strip() for token in dependencies.split(",") if token.strip()],
        risk_score=max(0, min(100, risk_score)),
    )
    db.add(new_activity)
    db.commit()
    return RedirectResponse(url=f"/ui/activities?project_id={project_id}&message=Activity created.", status_code=303)


@router.post("/ui/projects/{project_id}/activities/{activity_id}/progress", include_in_schema=False)
def ui_update_activity_progress(
    request: Request,
    db: DBSession,
    project_id: str,
    activity_id: str,
    status: Annotated[str, Form()] = ActivityStatus.in_progress.value,
    completion_percentage: Annotated[int, Form()] = 0,
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
        return RedirectResponse(
            url=f"/ui/activities?project_id={project_id}&message=Activity not found.",
            status_code=303,
        )
    try:
        activity.status = ActivityStatus(status)
    except ValueError:
        pass
    activity.completion_percentage = max(0, min(100, completion_percentage))
    activity.delay_reason = delay_reason.strip()
    activity.remarks = remarks.strip()
    db.commit()
    return RedirectResponse(url=f"/ui/activities?project_id={project_id}&message=Activity updated.", status_code=303)


@router.post("/ui/projects/{project_id}/activities/{activity_id}/delete", include_in_schema=False)
def ui_delete_activity(request: Request, db: DBSession, project_id: str, activity_id: str) -> RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    if user.role not in {UserRole.planner, UserRole.management}:
        return RedirectResponse(
            url=f"/ui/activities?project_id={project_id}&message=Only planning or management can delete activities.",
            status_code=303,
        )
    activity = db.scalar(
        select(Activity).where(Activity.project_id == project_id, Activity.id == activity_id)
    )
    if activity is not None:
        db.delete(activity)
        db.commit()
    return RedirectResponse(url=f"/ui/activities?project_id={project_id}&message=Activity deleted.", status_code=303)


def _render_planning_page(
    request: Request,
    db: DBSession,
    project_id: str | None,
    template_name: str,
    current_path: str,
    title: str,
    extra_context: dict[str, object],
) -> HTMLResponse | RedirectResponse:
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
) -> HTMLResponse | RedirectResponse:
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
) -> HTMLResponse | RedirectResponse:
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
) -> HTMLResponse | RedirectResponse:
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
) -> HTMLResponse | RedirectResponse:
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
) -> HTMLResponse | RedirectResponse:
    user = _get_cookie_user(request, db)
    if user is None:
        return _login_redirect()
    projects = _ensure_projects(db, user)
    active_project = _resolve_project(projects, project_id)
    activities = list(db.scalars(select(Activity).where(Activity.project_id == active_project.id)).all())
    anomalies = detect_activity_anomalies(activities)
    baselines = list(
        db.scalars(select(Baseline).where(Baseline.project_id == active_project.id).order_by(Baseline.created_at.desc())).all()
    )
    actions = list(
        db.scalars(select(ActionItem).where(ActionItem.project_id == active_project.id).order_by(ActionItem.updated_at.desc())).all()
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
) -> HTMLResponse | RedirectResponse:
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
) -> HTMLResponse | RedirectResponse:
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
) -> HTMLResponse | RedirectResponse:
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
