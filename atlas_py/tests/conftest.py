"""Test fixtures for API integration tests."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["ATLAS_ENV"] = "test"
os.environ["ATLAS_DATABASE_URL"] = "sqlite:///./test_atlas_platform.db"
os.environ["ATLAS_SECRET_KEY"] = "test-secret-key"
os.environ["ATLAS_SEED_DEMO_USERS"] = "true"

from atlas_platform.database import Base, engine
from atlas_platform.main import app


@pytest.fixture(autouse=True)
def reset_db() -> None:
    """Reset database schema before each test for deterministic behavior."""

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client() -> TestClient:
    """Create API test client."""

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db() -> None:
    """Remove sqlite test database file at the end of the run."""

    yield
    db_path = Path("test_atlas_platform.db")
    if db_path.exists():
        db_path.unlink()
