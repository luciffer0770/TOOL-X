"""FastAPI application bootstrap."""

from __future__ import annotations

import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, select, text

from psetw_platform.core.config import get_settings
from psetw_platform.core.logging import configure_logging
from psetw_platform.core.security import get_password_hash
from psetw_platform.database import Base, SessionLocal, engine
from psetw_platform.models import User, UserRole
from psetw_platform.routers import (
    actions,
    activities,
    analytics,
    auth,
    baselines,
    dashboard,
    health,
    legacy,
    planning,
    projects,
    scenarios,
    web,
)

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("psetw_platform")


def apply_startup_migrations() -> None:
    """Apply lightweight SQLite-compatible schema updates for additive columns."""

    inspector = inspect(engine)
    if "projects" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("projects")}
    alterations = [
        ("project_code", "ALTER TABLE projects ADD COLUMN project_code VARCHAR(64) NOT NULL DEFAULT ''"),
        ("customer_oem", "ALTER TABLE projects ADD COLUMN customer_oem VARCHAR(200) NOT NULL DEFAULT ''"),
        ("engine_type", "ALTER TABLE projects ADD COLUMN engine_type VARCHAR(200) NOT NULL DEFAULT ''"),
        ("engine_serial_no", "ALTER TABLE projects ADD COLUMN engine_serial_no VARCHAR(200) NOT NULL DEFAULT ''"),
        ("trolley_code", "ALTER TABLE projects ADD COLUMN trolley_code VARCHAR(120) NOT NULL DEFAULT ''"),
        ("trolley_location", "ALTER TABLE projects ADD COLUMN trolley_location VARCHAR(200) NOT NULL DEFAULT ''"),
        ("project_manager", "ALTER TABLE projects ADD COLUMN project_manager VARCHAR(200) NOT NULL DEFAULT ''"),
        ("planned_start_date", "ALTER TABLE projects ADD COLUMN planned_start_date DATE"),
        ("target_finish_date", "ALTER TABLE projects ADD COLUMN target_finish_date DATE"),
        ("contract_reference", "ALTER TABLE projects ADD COLUMN contract_reference VARCHAR(200) NOT NULL DEFAULT ''"),
        (
            "working_hours_per_day",
            "ALTER TABLE projects ADD COLUMN working_hours_per_day INTEGER NOT NULL DEFAULT 8",
        ),
        (
            "warning_threshold_days",
            "ALTER TABLE projects ADD COLUMN warning_threshold_days INTEGER NOT NULL DEFAULT 7",
        ),
        (
            "critical_threshold_days",
            "ALTER TABLE projects ADD COLUMN critical_threshold_days INTEGER NOT NULL DEFAULT 14",
        ),
        ("is_archived", "ALTER TABLE projects ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT 0"),
        ("updated_by", "ALTER TABLE projects ADD COLUMN updated_by VARCHAR(100) NOT NULL DEFAULT ''"),
    ]
    with engine.begin() as connection:
        for column_name, ddl in alterations:
            if column_name not in existing_columns:
                connection.execute(text(ddl))


def seed_demo_users() -> None:
    """Seed default role accounts for non-production environments."""

    if not settings.seed_demo_users:
        return

    defaults = [
        ("planner", "Planner", UserRole.planner, "planner123"),
        ("management", "Management", UserRole.management, "management123"),
        ("technician", "Technician", UserRole.technician, "technician123"),
    ]
    with SessionLocal() as db:
        for username, display_name, role, password in defaults:
            existing = db.scalar(select(User).where(User.username == username))
            if existing is not None:
                continue
            db.add(
                User(
                    username=username,
                    display_name=display_name,
                    role=role,
                    password_hash=get_password_hash(password),
                )
            )
        db.commit()


def create_app() -> FastAPI:
    """Create configured FastAPI app."""

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    @app.on_event("startup")
    def _startup() -> None:
        apply_startup_migrations()
        Base.metadata.create_all(bind=engine)
        seed_demo_users()
        logger.info("PS-ETW platform startup complete")

    static_dir = Path(__file__).resolve().parent / "web" / "static"
    app.mount("/ui-static", StaticFiles(directory=str(static_dir)), name="ui-static")

    app.include_router(health.router, prefix="/api")
    app.include_router(legacy.router)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(projects.router, prefix="/api/v1")
    app.include_router(activities.router, prefix="/api/v1")
    app.include_router(baselines.router, prefix="/api/v1")
    app.include_router(actions.router, prefix="/api/v1")
    app.include_router(scenarios.router, prefix="/api/v1")
    app.include_router(analytics.router, prefix="/api/v1")
    app.include_router(dashboard.router, prefix="/api/v1")
    app.include_router(planning.router, prefix="/api/v1")
    app.include_router(web.router)

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(url="/ui", status_code=307)

    return app


app = create_app()


def main() -> None:
    """Run local dev server."""

    uvicorn.run(
        "psetw_platform.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.env != "prod",
    )


if __name__ == "__main__":
    main()
