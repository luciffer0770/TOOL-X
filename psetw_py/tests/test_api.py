"""Core API behavior tests."""

from __future__ import annotations

import re

from fastapi.testclient import TestClient


def _auth_headers(client: TestClient, username: str = "planner", password: str = "planner123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_auth_login_and_me(client: TestClient) -> None:
    headers = _auth_headers(client)
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["username"] == "planner"


def test_project_activity_metrics_flow(client: TestClient) -> None:
    headers = _auth_headers(client)

    create_project = client.post("/api/v1/projects", json={"name": "Project Alpha"}, headers=headers)
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    create_activity = client.post(
        f"/api/v1/projects/{project_id}/activities",
        json={
            "activity_code": "ACT-0001",
            "activity_name": "Fixture Strategy Freeze",
            "phase": "Preparation",
            "status": "In Progress",
            "completion_percentage": 55,
            "base_effort_hours": 24,
            "dependencies": [],
            "risk_score": 62,
        },
        headers=headers,
    )
    assert create_activity.status_code == 201

    metrics_response = client.get(f"/api/v1/projects/{project_id}/analytics/portfolio-metrics", headers=headers)
    assert metrics_response.status_code == 200
    metrics = metrics_response.json()
    assert metrics["total_activities"] == 1
    assert metrics["high_risk_activities"] == 1


def test_phase2_analytics_endpoints(client: TestClient) -> None:
    headers = _auth_headers(client)

    create_project = client.post("/api/v1/projects", json={"name": "Project Beta"}, headers=headers)
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    create_a = client.post(
        f"/api/v1/projects/{project_id}/activities",
        json={
            "activity_code": "A-100",
            "activity_name": "Kickoff and BOM lock",
            "phase": "Planning",
            "status": "In Progress",
            "completion_percentage": 40,
            "planned_start_date": "2026-01-01",
            "planned_end_date": "2026-01-10",
            "dependencies": ["A-200"],
            "risk_score": 82,
            "delay_reason": "",
        },
        headers=headers,
    )
    assert create_a.status_code == 201

    create_b = client.post(
        f"/api/v1/projects/{project_id}/activities",
        json={
            "activity_code": "A-200",
            "activity_name": "Supplier sample release",
            "phase": "Execution",
            "status": "Completed",
            "completion_percentage": 100,
            "planned_start_date": "2026-01-03",
            "planned_end_date": "2026-01-20",
            "actual_end_date": "2026-01-18",
            "dependencies": ["A-100"],
            "risk_score": 45,
        },
        headers=headers,
    )
    assert create_b.status_code == 201

    create_c = client.post(
        f"/api/v1/projects/{project_id}/activities",
        json={
            "activity_code": "A-300",
            "activity_name": "Validation closure",
            "phase": "Validation",
            "status": "In Progress",
            "completion_percentage": 100,
            "planned_start_date": "2026-01-21",
            "planned_end_date": "2026-02-01",
            "risk_score": 15,
        },
        headers=headers,
    )
    assert create_c.status_code == 201

    delay_risk_response = client.get(f"/api/v1/projects/{project_id}/analytics/delay-risk", headers=headers)
    assert delay_risk_response.status_code == 200
    delay_risk_rows = delay_risk_response.json()
    assert len(delay_risk_rows) >= 1
    assert delay_risk_rows[0]["risk_level"] in {"Critical", "High", "Medium", "Low"}

    dependency_response = client.get(
        f"/api/v1/projects/{project_id}/analytics/dependency-health", headers=headers
    )
    assert dependency_response.status_code == 200
    dependency_payload = dependency_response.json()
    assert dependency_payload["cycle_count"] >= 2
    assert dependency_payload["missing_dependency_links"] == 0

    anomaly_response = client.get(f"/api/v1/projects/{project_id}/analytics/anomalies", headers=headers)
    assert anomaly_response.status_code == 200
    anomalies = anomaly_response.json()
    anomaly_rules = {row["rule_id"] for row in anomalies}
    assert "ACT-002" in anomaly_rules
    assert "ACT-003" in anomaly_rules


def test_phase2_planning_endpoints(client: TestClient) -> None:
    headers = _auth_headers(client)

    create_project = client.post("/api/v1/projects", json={"name": "Planning Project"}, headers=headers)
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    activities = [
        {
            "activity_code": "P-100",
            "activity_name": "Design freeze",
            "phase": "Planning",
            "status": "In Progress",
            "completion_percentage": 45,
            "planned_start_date": "2026-01-03",
            "planned_end_date": "2026-01-12",
            "base_effort_hours": 72,
            "dependencies": [],
            "dependency_type": "FS",
            "priority": "High",
            "assigned_manpower": 2,
            "material_status": "Ordered",
            "material_ownership": "Mechanical",
            "material_criticality": "Critical",
            "material_required_date": "2026-01-15",
            "material_lead_time": 48,
            "risk_score": 78,
            "risk_probability": 4,
            "risk_impact": 5,
            "estimated_cost": 12000,
            "actual_cost": 14000,
        },
        {
            "activity_code": "P-200",
            "activity_name": "Supplier validation",
            "phase": "Execution",
            "status": "Not Started",
            "completion_percentage": 0,
            "planned_start_date": "2026-01-13",
            "planned_end_date": "2026-01-22",
            "base_effort_hours": 80,
            "dependencies": ["P-100"],
            "dependency_type": "FS",
            "priority": "Medium",
            "assigned_manpower": 1,
            "material_status": "Not Ordered",
            "material_ownership": "Electrical",
            "material_criticality": "High",
            "material_required_date": "2026-01-18",
            "risk_score": 58,
            "risk_probability": 3,
            "risk_impact": 4,
            "estimated_cost": 8000,
            "actual_cost": 0,
        },
        {
            "activity_code": "P-300",
            "activity_name": "PV sign-off",
            "phase": "Validation",
            "status": "Completed",
            "completion_percentage": 100,
            "planned_start_date": "2026-01-23",
            "planned_end_date": "2026-01-25",
            "actual_start_date": "2026-01-23",
            "actual_end_date": "2026-01-24",
            "base_effort_hours": 24,
            "dependencies": ["P-200"],
            "material_status": "Received",
            "material_ownership": "QA",
            "material_criticality": "Medium",
            "material_required_date": "2026-01-20",
            "material_received_date": "2026-01-20",
            "risk_score": 15,
            "estimated_cost": 3000,
            "actual_cost": 2800,
        },
    ]

    for payload in activities:
        created = client.post(f"/api/v1/projects/{project_id}/activities", json=payload, headers=headers)
        assert created.status_code == 201

    timeline = client.get(f"/api/v1/projects/{project_id}/planning/timeline-bounds", headers=headers)
    assert timeline.status_code == 200
    assert timeline.json()["min_date"] <= "2026-01-03"

    phase_progress = client.get(f"/api/v1/projects/{project_id}/planning/phase-progress", headers=headers)
    assert phase_progress.status_code == 200
    assert len(phase_progress.json()) >= 3

    gantt = client.get(f"/api/v1/projects/{project_id}/planning/gantt", headers=headers)
    assert gantt.status_code == 200
    gantt_rows = gantt.json()
    assert len(gantt_rows) == 3
    assert any(row["critical_path"] for row in gantt_rows)

    calendar = client.get(
        f"/api/v1/projects/{project_id}/planning/calendar",
        params={"start": "2026-01-01", "end": "2026-01-31"},
        headers=headers,
    )
    assert calendar.status_code == 200
    assert len(calendar.json()) >= 20

    network = client.get(f"/api/v1/projects/{project_id}/planning/network", headers=headers)
    assert network.status_code == 200
    graph = network.json()
    assert len(graph["nodes"]) == 3
    assert len(graph["edges"]) >= 2

    materials = client.get(f"/api/v1/projects/{project_id}/planning/materials-health", headers=headers)
    assert materials.status_code == 200
    material_payload = materials.json()
    assert material_payload["pending_critical_count"] >= 1

    simulation = client.post(
        f"/api/v1/projects/{project_id}/planning/simulate",
        json={"manpower_boost_pct": 20, "overtime_hours_per_day": 2, "lead_time_reduction_pct": 10},
        headers=headers,
    )
    assert simulation.status_code == 200
    simulation_payload = simulation.json()
    assert "improvement_hours" in simulation_payload
    assert len(simulation_payload["impacts"]) == 3

    dashboard = client.get(f"/api/v1/projects/{project_id}/dashboard/overview", headers=headers)
    assert dashboard.status_code == 200
    dashboard_payload = dashboard.json()
    assert "portfolio_metrics" in dashboard_payload
    assert "timeline_bounds" in dashboard_payload
    assert "action_summary" in dashboard_payload


def test_legacy_compat_auth_and_state_endpoints(client: TestClient) -> None:
    login = client.post(
        "/api/auth/login",
        json={"username": "planner", "password": "planner123", "rememberMe": True},
    )
    assert login.status_code == 200
    login_payload = login.json()
    assert login_payload["ok"] is True
    assert login_payload["token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {login_payload['token']}"})
    assert me.status_code == 200
    me_payload = me.json()
    assert me_payload["ok"] is True
    assert me_payload["user"]["username"] == "planner"

    default_state = client.get("/api/state")
    assert default_state.status_code == 200
    assert "projects" in default_state.json()

    updated_state = {
        "projects": [{"id": "PRJ-0099", "name": "Legacy Project", "activities": [], "baselines": [], "actions": []}],
        "activeProjectId": "PRJ-0099",
        "settings": {"tableColumnVisibility": {}, "defaultEditor": "Planner"},
    }
    save_state = client.put("/api/state", json=updated_state)
    assert save_state.status_code == 200
    assert save_state.json()["ok"] is True

    loaded_state = client.get("/api/state")
    assert loaded_state.status_code == 200
    assert loaded_state.json()["activeProjectId"] == "PRJ-0099"

    logout = client.post("/api/auth/logout", json={"token": login_payload["token"]})
    assert logout.status_code == 200
    assert logout.json()["ok"] is True


def test_server_rendered_ui_login_and_pages(client: TestClient) -> None:
    login_page = client.get("/ui/login")
    assert login_page.status_code == 200
    assert "PS-ETW Preparation Planner" in login_page.text
    assert "Sign In" in login_page.text

    login = client.post(
        "/ui/login",
        data={"username": "planner", "password": "planner123", "remember_me": "true"},
        follow_redirects=False,
    )
    assert login.status_code == 303
    assert login.headers["location"] == "/ui/dashboard"
    auth_cookie = login.cookies.get("psetw_ui_session")
    assert auth_cookie is not None

    cookies = {"psetw_ui_session": auth_cookie}
    dashboard = client.get("/ui/dashboard", cookies=cookies)
    assert dashboard.status_code == 200
    assert "Executive Dashboard" in dashboard.text

    create_project = client.post("/api/v1/projects", json={"name": "UI Project"}, headers=_auth_headers(client))
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    create_activity = client.post(
        f"/ui/projects/{project_id}/activities",
        data={
            "activity_code": "UI-100",
            "activity_name": "Rendered UI flow",
            "phase": "Planning",
            "status": "In Progress",
            "planned_start_date": "2026-03-01",
            "planned_end_date": "2026-03-05",
            "completion_percentage": "40",
            "base_effort_hours": "32",
            "risk_score": "60",
        },
        cookies=cookies,
        follow_redirects=False,
    )
    assert create_activity.status_code == 303

    activities_page = client.get(f"/ui/activities?project_id={project_id}", cookies=cookies)
    assert activities_page.status_code == 200
    assert "UI-100" in activities_page.text

    gantt_page = client.get(
        f"/ui/gantt?project_id={project_id}",
        cookies=cookies,
        follow_redirects=False,
    )
    assert gantt_page.status_code == 303
    assert "/ui/calendar" in gantt_page.headers["location"]

    calendar_page = client.get(f"/ui/calendar?project_id={project_id}", cookies=cookies)
    assert calendar_page.status_code == 200
    assert "Calendar Scheduling Console" in calendar_page.text

    delay_page = client.get(f"/ui/delay-optimization?project_id={project_id}", cookies=cookies)
    assert delay_page.status_code == 200
    assert "Delay &amp; Optimization" in delay_page.text

    engine_page = client.get(f"/ui/engine-description?project_id={project_id}", cookies=cookies)
    assert engine_page.status_code == 200
    assert "Engine Description" in engine_page.text

    settings_page = client.get(f"/ui/settings?project_id={project_id}", cookies=cookies)
    assert settings_page.status_code == 200
    assert "Settings" in settings_page.text


def test_ui_activities_import_export_and_bulk_actions(client: TestClient) -> None:
    login = client.post(
        "/ui/login",
        data={"username": "planner", "password": "planner123", "remember_me": "true"},
        follow_redirects=False,
    )
    assert login.status_code == 303
    auth_cookie = login.cookies.get("psetw_ui_session")
    assert auth_cookie
    cookies = {"psetw_ui_session": auth_cookie}

    create_project = client.post(
        "/api/v1/projects",
        json={"name": "Import Export Project"},
        headers=_auth_headers(client),
    )
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    csv_payload = (
        "Activity ID,Activity Name,Phase,Sub Activity,Base Effort Hours,Required Materials,Required Tools,"
        "Material Ownership,Material Lead Time,Dependencies,Activity Status,Completion Percentage,Risk Score\n"
        "ACT-100,Line Install,Build-Up,Prep,24,Frame,Torque Wrench,Mechanical,12,,In Progress,35,65\n"
        "ACT-200,Validation Run,Validation,Trial,16,Sensor,Analyzer,Electrical,8,ACT-100,Not Started,0,45\n"
    )
    import_response = client.post(
        f"/ui/projects/{project_id}/activities/import",
        data={"merge_strategy": "merge"},
        files={"file": ("activities.csv", csv_payload, "text/csv")},
        cookies=cookies,
        follow_redirects=False,
    )
    assert import_response.status_code == 303

    activities_page = client.get(f"/ui/activities?project_id={project_id}&search=ACT-100", cookies=cookies)
    assert activities_page.status_code == 200
    assert "ACT-100" in activities_page.text

    api_headers = _auth_headers(client)
    list_response = client.get(f"/api/v1/projects/{project_id}/activities", headers=api_headers)
    assert list_response.status_code == 200
    first_id = list_response.json()[0]["id"]

    bulk_status = client.post(
        f"/ui/projects/{project_id}/activities/bulk-status",
        data={"selected_ids": [first_id], "bulk_status": "Delayed"},
        cookies=cookies,
        follow_redirects=False,
    )
    assert bulk_status.status_code == 303

    export_csv = client.get(f"/ui/projects/{project_id}/activities/export.csv", cookies=cookies)
    assert export_csv.status_code == 200
    assert "Activity ID" in export_csv.text

    export_json = client.get(f"/ui/projects/{project_id}/activities/export.json", cookies=cookies)
    assert export_json.status_code == 200
    assert "ACT-100" in export_json.text


def test_ui_anomaly_baseline_and_action_workflows(client: TestClient) -> None:
    login = client.post(
        "/ui/login",
        data={"username": "planner", "password": "planner123", "remember_me": "true"},
        follow_redirects=False,
    )
    assert login.status_code == 303
    auth_cookie = login.cookies.get("psetw_ui_session")
    assert auth_cookie
    cookies = {"psetw_ui_session": auth_cookie}

    create_project = client.post("/api/v1/projects", json={"name": "Anomaly Project"}, headers=_auth_headers(client))
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    create_activity = client.post(
        f"/ui/projects/{project_id}/activities",
        data={
            "activity_code": "AN-100",
            "activity_name": "Action Source",
            "phase": "Validation",
            "status": "In Progress",
            "completion_percentage": "50",
            "base_effort_hours": "16",
            "risk_score": "70",
            "required_materials": "Cable",
            "required_tools": "Meter",
            "material_ownership": "Mechanical",
            "material_lead_time": "6",
            "dependencies": "",
            "sub_activity": "Wire checks",
        },
        cookies=cookies,
        follow_redirects=False,
    )
    assert create_activity.status_code == 303

    baseline_create = client.post(
        f"/ui/projects/{project_id}/baselines",
        data={"name": "B1"},
        cookies=cookies,
        follow_redirects=False,
    )
    assert baseline_create.status_code == 303

    anomaly_page = client.get(f"/ui/anomaly-center?project_id={project_id}", cookies=cookies)
    assert anomaly_page.status_code == 200
    assert "B1" in anomaly_page.text

    headers = _auth_headers(client)
    activities = client.get(f"/api/v1/projects/{project_id}/activities", headers=headers).json()
    activity_id = activities[0]["id"]

    action_create = client.post(
        f"/ui/projects/{project_id}/actions",
        data={
            "activity_id": activity_id,
            "title": "Close anomaly",
            "owner": "Planner",
            "priority": "High",
            "status": "Open",
        },
        cookies=cookies,
        follow_redirects=False,
    )
    assert action_create.status_code == 303

    actions = client.get(f"/api/v1/projects/{project_id}/actions", headers=headers).json()
    assert len(actions) == 1
    action_id = actions[0]["id"]

    action_status = client.post(
        f"/ui/projects/{project_id}/actions/{action_id}/status",
        data={"status": "Closed"},
        cookies=cookies,
        follow_redirects=False,
    )
    assert action_status.status_code == 303

    actions_after = client.get(f"/api/v1/projects/{project_id}/actions", headers=headers).json()
    assert actions_after[0]["status"] == "Closed"


def test_ui_calendar_reschedule_and_eod_logs(client: TestClient) -> None:
    login = client.post(
        "/ui/login",
        data={"username": "planner", "password": "planner123", "remember_me": "true"},
        follow_redirects=False,
    )
    assert login.status_code == 303
    auth_cookie = login.cookies.get("psetw_ui_session")
    assert auth_cookie
    cookies = {"psetw_ui_session": auth_cookie}
    headers = _auth_headers(client)

    create_project = client.post("/api/v1/projects", json={"name": "Calendar EOD Project"}, headers=headers)
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    create_activity = client.post(
        f"/ui/projects/{project_id}/activities",
        data={
            "activity_code": "CAL-100",
            "activity_name": "Movable Activity",
            "phase": "Execution",
            "status": "Not Started",
            "planned_start_date": "2026-03-10",
            "planned_end_date": "2026-03-12",
            "completion_percentage": "0",
            "base_effort_hours": "16",
            "risk_score": "10",
        },
        cookies=cookies,
        follow_redirects=False,
    )
    assert create_activity.status_code == 303

    activities = client.get(f"/api/v1/projects/{project_id}/activities", headers=headers).json()
    assert len(activities) == 1
    activity_id = activities[0]["id"]

    move_response = client.post(
        f"/ui/projects/{project_id}/activities/{activity_id}/reschedule",
        data={"target_date": "2026-03-20"},
        cookies=cookies,
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    assert move_response.status_code == 200
    payload = move_response.json()
    assert payload["ok"] is True
    assert payload["start"] == "2026-03-20"

    updated = client.get(f"/api/v1/projects/{project_id}/activities", headers=headers).json()
    assert updated[0]["planned_start_date"] == "2026-03-20"
    assert updated[0]["planned_end_date"] == "2026-03-22"

    create_eod = client.post(
        f"/ui/projects/{project_id}/eod-logs",
        data={
            "log_date": "2026-03-20",
            "engineer": "Planner",
            "activities_worked_on": "CAL-100",
            "phase": "Execution",
            "activity_count": "1",
            "hours_logged": "8",
            "progress_delta": "15",
            "blockers": "None",
            "next_day_plan": "Continue execution",
            "materials_received": "Harness",
            "issues_observed": "No defects",
            "status": "Submitted",
            "verified_by": "Lead",
        },
        cookies=cookies,
        follow_redirects=False,
    )
    assert create_eod.status_code == 303
    assert "/ui/eod-logs" in create_eod.headers["location"]

    eod_page = client.get(f"/ui/eod-logs?project_id={project_id}", cookies=cookies)
    assert eod_page.status_code == 200
    assert "EOD History (1)" in eod_page.text
    assert "CAL-100" in eod_page.text


def test_ui_engine_description_upload_and_download(client: TestClient) -> None:
    login = client.post(
        "/ui/login",
        data={"username": "planner", "password": "planner123", "remember_me": "true"},
        follow_redirects=False,
    )
    assert login.status_code == 303
    auth_cookie = login.cookies.get("psetw_ui_session")
    assert auth_cookie
    cookies = {"psetw_ui_session": auth_cookie}
    headers = _auth_headers(client)

    create_project = client.post("/api/v1/projects", json={"name": "Engine Docs Project"}, headers=headers)
    assert create_project.status_code == 201
    project_id = create_project.json()["id"]

    csv_payload = (
        "Engine Model,Customer,Scope,Remarks\n"
        "V8-TT,Customer A,Preparation validation,Gate review required\n"
    )
    upload = client.post(
        f"/ui/projects/{project_id}/engine-documents/upload",
        data={"engine_model": "", "customer": "", "scope": "", "remarks": ""},
        files={"file": ("engine_requirements.csv", csv_payload, "text/csv")},
        cookies=cookies,
        follow_redirects=False,
    )
    assert upload.status_code == 303
    assert "/ui/engine-description" in upload.headers["location"]

    page = client.get(f"/ui/engine-description?project_id={project_id}", cookies=cookies)
    assert page.status_code == 200
    assert "engine_requirements.csv" in page.text
    assert "V8-TT" in page.text

    match = re.search(r"/ui/projects/.*/engine-documents/([a-f0-9\\-]+)/download", page.text)
    assert match is not None
    document_id = match.group(1)

    download = client.get(
        f"/ui/projects/{project_id}/engine-documents/{document_id}/download",
        cookies=cookies,
    )
    assert download.status_code == 200
    assert "Engine Model,Customer,Scope,Remarks" in download.text
