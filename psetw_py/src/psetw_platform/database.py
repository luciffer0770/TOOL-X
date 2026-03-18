"""Database engine and session factories."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from psetw_platform.core.config import get_settings


class Base(DeclarativeBase):
    """Base class for ORM entities."""


settings = get_settings()
is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if is_sqlite else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, class_=Session)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency for transactional session scope."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
