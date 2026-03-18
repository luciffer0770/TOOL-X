"""Core API behavior tests."""

from __future__ import annotations

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
