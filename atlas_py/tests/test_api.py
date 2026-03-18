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
