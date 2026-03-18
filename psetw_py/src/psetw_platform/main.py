"""FastAPI application bootstrap."""

from __future__ import annotations

import logging

import uvicorn
from fastapi import FastAPI
from sqlalchemy import select

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
    planning,
    projects,
    scenarios,
)

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("psetw_platform")


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
        Base.metadata.create_all(bind=engine)
        seed_demo_users()
        logger.info("PS-ETW platform startup complete")

    app.include_router(health.router, prefix="/api")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(projects.router, prefix="/api/v1")
    app.include_router(activities.router, prefix="/api/v1")
    app.include_router(baselines.router, prefix="/api/v1")
    app.include_router(actions.router, prefix="/api/v1")
    app.include_router(scenarios.router, prefix="/api/v1")
    app.include_router(analytics.router, prefix="/api/v1")
    app.include_router(dashboard.router, prefix="/api/v1")
    app.include_router(planning.router, prefix="/api/v1")

    @app.get("/")
    def root() -> dict[str, str]:
        return {"service": settings.app_name, "status": "running", "docs": "/docs"}

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
