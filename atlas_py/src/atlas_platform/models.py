"""SQLAlchemy ORM entities."""

from __future__ import annotations

from datetime import UTC, date, datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from atlas_platform.database import Base


def utc_now() -> datetime:
    """Return timezone-aware UTC timestamp."""

    return datetime.now(UTC)


class UserRole(StrEnum):
    planner = "planner"
    management = "management"
    technician = "technician"


class ActivityStatus(StrEnum):
    not_started = "Not Started"
    in_progress = "In Progress"
    blocked = "Blocked"
    delayed = "Delayed"
    completed = "Completed"


class ActionStatus(StrEnum):
    open = "Open"
    in_review = "In Review"
    closed = "Closed"


class ActionPriority(StrEnum):
    low = "Low"
    medium = "Medium"
    high = "High"
    critical = "Critical"


class User(Base):
    """Authenticated platform user."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.planner)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Project(Base):
    """Project aggregate root."""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(200))
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    activities: Mapped[list[Activity]] = relationship(
        "Activity", back_populates="project", cascade="all, delete-orphan"
    )
    baselines: Mapped[list[Baseline]] = relationship(
        "Baseline", back_populates="project", cascade="all, delete-orphan"
    )
    actions: Mapped[list[ActionItem]] = relationship(
        "ActionItem", back_populates="project", cascade="all, delete-orphan"
    )
    scenarios: Mapped[list[Scenario]] = relationship(
        "Scenario", back_populates="project", cascade="all, delete-orphan"
    )


class Activity(Base):
    """Project activity record."""

    __tablename__ = "activities"
    __table_args__ = (UniqueConstraint("project_id", "activity_code", name="uq_activity_code_project"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    activity_code: Mapped[str] = mapped_column(String(64))
    activity_name: Mapped[str] = mapped_column(String(300))
    phase: Mapped[str] = mapped_column(String(120), default="")
    status: Mapped[ActivityStatus] = mapped_column(Enum(ActivityStatus), default=ActivityStatus.not_started)
    completion_percentage: Mapped[int] = mapped_column(Integer, default=0)
    planned_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    planned_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actual_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    base_effort_hours: Mapped[int] = mapped_column(Integer, default=0)
    dependencies: Mapped[list[str]] = mapped_column(JSON, default=list)
    material_status: Mapped[str] = mapped_column(String(120), default="Not Ordered")
    material_ownership: Mapped[str] = mapped_column(String(120), default="Mechanical")
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    delay_reason: Mapped[str] = mapped_column(Text, default="")
    remarks: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship("Project", back_populates="activities")


class Baseline(Base):
    """Immutable project snapshot metadata and content."""

    __tablename__ = "baselines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    snapshot: Mapped[dict[str, object]] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    project: Mapped[Project] = relationship("Project", back_populates="baselines")


class ActionItem(Base):
    """Mitigation/corrective action linked to project activity."""

    __tablename__ = "actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[str | None] = mapped_column(ForeignKey("activities.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    owner: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[ActionPriority] = mapped_column(Enum(ActionPriority), default=ActionPriority.medium)
    status: Mapped[ActionStatus] = mapped_column(Enum(ActionStatus), default=ActionStatus.open)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    project: Mapped[Project] = relationship("Project", back_populates="actions")


class Scenario(Base):
    """Saved what-if scenario and resulting outputs."""

    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    scenario_input: Mapped[dict[str, object]] = mapped_column(JSON)
    scenario_result: Mapped[dict[str, object]] = mapped_column(JSON)
    saved_by: Mapped[str] = mapped_column(String(100))
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    project: Mapped[Project] = relationship("Project", back_populates="scenarios")


class AuditEvent(Base):
    """Append-only audit log for traceability and compliance."""

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_username: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(200))
    entity_type: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[str] = mapped_column(String(100))
    details: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
