"""Pydantic API schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

from psetw_platform.models import ActionPriority, ActionStatus, ActivityStatus, UserRole


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    username: str
    display_name: str
    role: UserRole


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    created_by: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActivityBase(BaseModel):
    activity_code: str = Field(min_length=1, max_length=64)
    activity_name: str = Field(min_length=1, max_length=300)
    phase: str = ""
    status: ActivityStatus = ActivityStatus.not_started
    completion_percentage: int = Field(default=0, ge=0, le=100)
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    actual_start_date: date | None = None
    actual_end_date: date | None = None
    base_effort_hours: int = Field(default=0, ge=0)
    dependencies: list[str] = Field(default_factory=list)
    material_status: str = "Not Ordered"
    material_ownership: str = "Mechanical"
    risk_score: int = Field(default=0, ge=0, le=100)
    delay_reason: str = ""
    remarks: str = ""


class ActivityCreate(ActivityBase):
    pass


class ActivityUpdate(BaseModel):
    activity_name: str | None = None
    phase: str | None = None
    status: ActivityStatus | None = None
    completion_percentage: int | None = Field(default=None, ge=0, le=100)
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    actual_start_date: date | None = None
    actual_end_date: date | None = None
    base_effort_hours: int | None = Field(default=None, ge=0)
    dependencies: list[str] | None = None
    material_status: str | None = None
    material_ownership: str | None = None
    risk_score: int | None = Field(default=None, ge=0, le=100)
    delay_reason: str | None = None
    remarks: str | None = None


class ActivityOut(ActivityBase):
    id: str
    project_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BaselineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class BaselineOut(BaseModel):
    id: str
    project_id: str
    name: str
    snapshot: dict[str, Any]
    created_by: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ActionCreate(BaseModel):
    activity_id: str | None = None
    title: str = Field(min_length=1, max_length=300)
    owner: str = Field(min_length=1, max_length=200)
    due_date: date | None = None
    priority: ActionPriority = ActionPriority.medium
    status: ActionStatus = ActionStatus.open
    notes: str = ""


class ActionUpdate(BaseModel):
    owner: str | None = None
    due_date: date | None = None
    priority: ActionPriority | None = None
    status: ActionStatus | None = None
    notes: str | None = None


class ActionOut(BaseModel):
    id: str
    project_id: str
    activity_id: str | None
    title: str
    owner: str
    due_date: date | None
    priority: ActionPriority
    status: ActionStatus
    notes: str
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ScenarioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scenario_input: dict[str, Any]
    scenario_result: dict[str, Any]


class ScenarioOut(BaseModel):
    id: str
    project_id: str
    name: str
    scenario_input: dict[str, Any]
    scenario_result: dict[str, Any]
    saved_by: str
    saved_at: datetime

    model_config = {"from_attributes": True}


class PortfolioMetrics(BaseModel):
    total_activities: int
    delayed_activities: int
    high_risk_activities: int
    completed_activities: int
    blocked_activities: int
    average_completion: float


class DelayRiskRow(BaseModel):
    activity_id: str
    activity_code: str
    activity_name: str
    phase: str
    status: ActivityStatus
    completion_percentage: int
    risk_score: int
    risk_level: str
    delayed: bool
    delay_days: int
    blocking_dependencies: list[str]
    delay_reason: str


class DependencyHealth(BaseModel):
    missing_by_activity: dict[str, list[str]]
    missing_dependency_links: int
    activities_with_missing_dependencies: int
    cycle_activity_ids: list[str]
    cycle_count: int


class AnomalyRow(BaseModel):
    rule_id: str
    activity_id: str
    activity_code: str
    activity_name: str
    severity: str
    issue: str
    details: str
    recommendation: str
