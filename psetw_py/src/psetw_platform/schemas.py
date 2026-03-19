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
    project_code: str
    customer_oem: str
    project_manager: str
    planned_start_date: date | None
    target_finish_date: date | None
    warning_threshold_days: int
    critical_threshold_days: int
    is_archived: bool
    created_by: str | None
    updated_by: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActivityBase(BaseModel):
    activity_code: str = Field(min_length=1, max_length=64)
    activity_name: str = Field(min_length=1, max_length=300)
    phase: str = ""
    sub_activity: str = ""
    status: ActivityStatus = ActivityStatus.not_started
    completion_percentage: int = Field(default=0, ge=0, le=100)
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    planned_duration_hours: int = Field(default=0, ge=0)
    actual_start_date: date | None = None
    actual_end_date: date | None = None
    actual_duration_hours: int = Field(default=0, ge=0)
    base_effort_hours: int = Field(default=0, ge=0)
    required_materials: str = ""
    required_tools: str = ""
    dependencies: list[str] = Field(default_factory=list)
    dependency_type: str = "FS"
    priority: str = "Medium"
    milestone: str = ""
    assigned_manpower: int = Field(default=1, ge=1)
    manpower_skill_level: str = ""
    resource_name: str = ""
    resource_department: str = ""
    shift_type: str = ""
    material_status: str = "Not Ordered"
    material_ownership: str = "Mechanical"
    material_supplier: str = ""
    material_criticality: str = "Medium"
    material_required_date: date | None = None
    material_received_date: date | None = None
    material_lead_time: int = Field(default=0, ge=0)
    risk_level: str = "Low"
    risk_score: int = Field(default=0, ge=0, le=100)
    risk_probability: int = Field(default=3, ge=1, le=5)
    risk_impact: int = Field(default=3, ge=1, le=5)
    risk_mitigation_status: str = "Planned"
    risk_owner: str = ""
    risk_review_date: date | None = None
    manual_override_duration: int = Field(default=0, ge=0)
    override_reason: str = ""
    override_approved_by: str = ""
    estimated_cost: int = Field(default=0, ge=0)
    actual_cost: int = Field(default=0, ge=0)
    cost_center: str = ""
    last_modified_by: str = ""
    last_modified_date: date | None = None
    delay_reason: str = ""
    remarks: str = ""


class ActivityCreate(ActivityBase):
    pass


class ActivityUpdate(BaseModel):
    activity_name: str | None = None
    phase: str | None = None
    sub_activity: str | None = None
    status: ActivityStatus | None = None
    completion_percentage: int | None = Field(default=None, ge=0, le=100)
    planned_start_date: date | None = None
    planned_end_date: date | None = None
    planned_duration_hours: int | None = Field(default=None, ge=0)
    actual_start_date: date | None = None
    actual_end_date: date | None = None
    actual_duration_hours: int | None = Field(default=None, ge=0)
    base_effort_hours: int | None = Field(default=None, ge=0)
    required_materials: str | None = None
    required_tools: str | None = None
    dependencies: list[str] | None = None
    dependency_type: str | None = None
    priority: str | None = None
    milestone: str | None = None
    assigned_manpower: int | None = Field(default=None, ge=1)
    manpower_skill_level: str | None = None
    resource_name: str | None = None
    resource_department: str | None = None
    shift_type: str | None = None
    material_status: str | None = None
    material_ownership: str | None = None
    material_supplier: str | None = None
    material_criticality: str | None = None
    material_required_date: date | None = None
    material_received_date: date | None = None
    material_lead_time: int | None = Field(default=None, ge=0)
    risk_level: str | None = None
    risk_score: int | None = Field(default=None, ge=0, le=100)
    risk_probability: int | None = Field(default=None, ge=1, le=5)
    risk_impact: int | None = Field(default=None, ge=1, le=5)
    risk_mitigation_status: str | None = None
    risk_owner: str | None = None
    risk_review_date: date | None = None
    manual_override_duration: int | None = Field(default=None, ge=0)
    override_reason: str | None = None
    override_approved_by: str | None = None
    estimated_cost: int | None = Field(default=None, ge=0)
    actual_cost: int | None = Field(default=None, ge=0)
    cost_center: str | None = None
    last_modified_by: str | None = None
    last_modified_date: date | None = None
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


class TimelineBounds(BaseModel):
    min_date: date
    max_date: date


class PhaseProgressRow(BaseModel):
    phase: str
    activity_count: int
    average_completion: float
    delayed_activities: int


class GanttRow(BaseModel):
    activity_id: str
    activity_code: str
    activity_name: str
    phase: str
    status: ActivityStatus
    planned_start_date: date | None
    planned_end_date: date | None
    planned_duration_hours: float
    completion_percentage: int
    risk_score: int
    delay_hours: float
    dependencies: list[str]
    blocking_dependencies: list[str]
    critical_path: bool


class CalendarActivityRow(BaseModel):
    activity_id: str
    activity_code: str
    activity_name: str
    status: ActivityStatus
    phase: str
    completion_percentage: int


class CalendarBucket(BaseModel):
    day: date
    activities: list[CalendarActivityRow]


class NetworkNode(BaseModel):
    activity_id: str
    activity_code: str
    activity_name: str
    status: ActivityStatus
    risk_score: int
    blocked: bool
    critical: bool


class NetworkEdge(BaseModel):
    dependency_code: str
    dependent_code: str


class NetworkGraph(BaseModel):
    nodes: list[NetworkNode]
    edges: list[NetworkEdge]
    critical_path_codes: list[str]
    cycle_activity_ids: list[str]
    missing_by_activity: dict[str, list[str]]


class MaterialHealth(BaseModel):
    ownership_counts: dict[str, int]
    status_counts: dict[str, int]
    pending_critical_count: int
    late_material_count: int


class ScenarioSimulationInput(BaseModel):
    manpower_boost_pct: float = Field(default=0.0, ge=0, le=100)
    overtime_hours_per_day: float = Field(default=0.0, ge=0, le=12)
    lead_time_reduction_pct: float = Field(default=0.0, ge=0, le=100)


class ScenarioImpactRow(BaseModel):
    activity_code: str
    activity_name: str
    start_date: date
    finish_date: date
    baseline_duration_hours: float
    simulated_duration_hours: float
    saved_hours: float


class ScenarioSimulationResult(BaseModel):
    baseline_finish_date: date | None
    simulated_finish_date: date | None
    improvement_hours: float
    impacts: list[ScenarioImpactRow]


class ActionSummary(BaseModel):
    total_actions: int
    open_actions: int
    overdue_actions: int


class AnomalySummary(BaseModel):
    total: int
    by_severity: dict[str, int]


class DashboardOverview(BaseModel):
    portfolio_metrics: PortfolioMetrics
    timeline_bounds: TimelineBounds
    phase_progress: list[PhaseProgressRow]
    top_risks: list[DelayRiskRow]
    dependency_health: DependencyHealth
    anomaly_summary: AnomalySummary
    action_summary: ActionSummary
    critical_path_codes: list[str]
