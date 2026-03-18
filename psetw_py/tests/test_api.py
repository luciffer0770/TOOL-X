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
