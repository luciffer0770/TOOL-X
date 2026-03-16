"""ATLAS Planner - Activity schema and sanitization (ported from js/schema.js)"""
from datetime import date
import re

COLUMN_SCHEMA = [
    {"key": "activityId", "label": "Activity ID", "type": "text", "required_import": True},
    {"key": "activityName", "label": "Activity Name", "type": "text", "required_import": True},
    {"key": "phase", "label": "Phase", "type": "text", "required_import": True},
    {"key": "subActivity", "label": "Sub Activity", "type": "text", "required_import": True},
    {"key": "baseEffortHours", "label": "Base Effort Hours", "type": "number", "required_import": True},
    {"key": "requiredMaterials", "label": "Required Materials", "type": "text", "required_import": True},
    {"key": "requiredTools", "label": "Required Tools", "type": "text", "required_import": True},
    {"key": "materialOwnership", "label": "Material Ownership", "type": "text", "required_import": True},
    {"key": "materialLeadTime", "label": "Material Lead Time", "type": "number", "required_import": True},
    {"key": "dependencies", "label": "Dependencies", "type": "text", "required_import": True},
    {"key": "plannedStartDate", "label": "Planned Start Date", "type": "date"},
    {"key": "plannedEndDate", "label": "Planned End Date", "type": "date"},
    {"key": "plannedDurationHours", "label": "Planned Duration Hours", "type": "number"},
    {"key": "priority", "label": "Priority", "type": "text"},
    {"key": "milestone", "label": "Milestone", "type": "text"},
    {"key": "assignedManpower", "label": "Assigned Manpower", "type": "number"},
    {"key": "manpowerSkillLevel", "label": "Manpower Skill Level", "type": "text"},
    {"key": "resourceName", "label": "Resource Name", "type": "text"},
    {"key": "resourceDepartment", "label": "Resource Department", "type": "text"},
    {"key": "shiftType", "label": "Shift Type", "type": "text"},
    {"key": "materialStatus", "label": "Material Status", "type": "text"},
    {"key": "materialSupplier", "label": "Supplier / Vendor", "type": "text"},
    {"key": "materialRequiredDate", "label": "Material Required Date", "type": "date"},
    {"key": "materialReceivedDate", "label": "Material Received Date", "type": "date"},
    {"key": "materialCriticality", "label": "Material Criticality", "type": "text"},
    {"key": "actualStartDate", "label": "Actual Start Date", "type": "date"},
    {"key": "actualEndDate", "label": "Actual End Date", "type": "date"},
    {"key": "actualDurationHours", "label": "Actual Duration Hours", "type": "number"},
    {"key": "activityStatus", "label": "Activity Status", "type": "text"},
    {"key": "completionPercentage", "label": "Completion Percentage", "type": "number"},
    {"key": "riskLevel", "label": "Risk Level", "type": "text"},
    {"key": "riskScore", "label": "Risk Score", "type": "number"},
    {"key": "riskProbability", "label": "Risk Probability", "type": "number"},
    {"key": "riskImpact", "label": "Risk Impact", "type": "number"},
    {"key": "riskMitigationStatus", "label": "Mitigation Status", "type": "text"},
    {"key": "riskOwner", "label": "Risk Owner", "type": "text"},
    {"key": "riskReviewDate", "label": "Risk Review Date", "type": "date"},
    {"key": "delayReason", "label": "Delay Reason", "type": "text"},
    {"key": "dependencyType", "label": "Dependency Type", "type": "text"},
    {"key": "manualOverrideDuration", "label": "Manual Override Duration", "type": "number"},
    {"key": "overrideReason", "label": "Override Reason", "type": "text"},
    {"key": "overrideApprovedBy", "label": "Override Approved By", "type": "text"},
    {"key": "estimatedCost", "label": "Estimated Cost", "type": "number"},
    {"key": "actualCost", "label": "Actual Cost", "type": "number"},
    {"key": "costCenter", "label": "Cost Center", "type": "text"},
    {"key": "lastModifiedBy", "label": "Last Modified By", "type": "text"},
    {"key": "lastModifiedDate", "label": "Last Modified Date", "type": "date"},
    {"key": "remarks", "label": "Remarks", "type": "text"},
]

ACTIVITY_STATUSES = ["Not Started", "In Progress", "Blocked", "Delayed", "Completed"]
PRIORITY_LEVELS = ["Low", "Medium", "High", "Critical"]
RISK_LEVELS = ["Low", "Medium", "High", "Critical"]
MATERIAL_STATUSES = ["Not Ordered", "Ordered", "In Transit", "Received", "Delayed"]
OWNERSHIP_TYPES = ["Client", "Mechanical", "Electrical", "Supplier"]


def now_iso_date() -> str:
    return date.today().isoformat()


def normalize_phase(phase: str) -> str:
    trimmed = (phase or "").strip()
    if not trimmed:
        return ""
    return trimmed[0].upper() + trimmed[1:].lower()


def _parse_number(value) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_date(value) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return ""
        try:
            return date.fromisoformat(v[:10]).isoformat()
        except (ValueError, TypeError):
            pass
    if isinstance(value, (int, float)):
        from datetime import datetime, timedelta
        epoch = datetime(1899, 12, 30)
        try:
            d = epoch + timedelta(days=float(value))
            return d.date().isoformat()
        except (ValueError, TypeError):
            pass
    try:
        d = date.fromisoformat(str(value)[:10])
        return d.isoformat()
    except (ValueError, TypeError):
        return ""


def _normalize_ownership(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return "Mechanical"
    n = raw.lower()
    if "electrical" in n:
        return "Electrical"
    if "mechanical" in n or "internal" in n:
        return "Mechanical"
    if "third" in n or "supplier" in n or "vendor" in n:
        return "Supplier"
    if "client" in n or "customer" in n or "joint" in n:
        return "Client"
    for t in OWNERSHIP_TYPES:
        if t.lower() == n:
            return t
    return "Mechanical"


def parse_dependencies(raw: str) -> list:
    if not raw:
        return []
    return [x.strip() for x in str(raw).split(",") if x.strip()]


def create_empty_activity() -> dict:
    act = {}
    for col in COLUMN_SCHEMA:
        if col["type"] == "number":
            act[col["key"]] = 0
        else:
            act[col["key"]] = ""
    act["activityStatus"] = "Not Started"
    act["completionPercentage"] = 0
    act["priority"] = "Medium"
    act["riskLevel"] = "Low"
    act["materialStatus"] = "Not Ordered"
    act["lastModifiedDate"] = now_iso_date()
    act["lastModifiedBy"] = "Planner"
    return act


def sanitize_activity(raw: dict | None) -> dict:
    base = create_empty_activity()
    merged = {**base, **(raw or {})}
    out = {}
    for col in COLUMN_SCHEMA:
        v = merged.get(col["key"])
        if col["type"] == "number":
            out[col["key"]] = _parse_number(v)
        elif col["type"] == "date":
            out[col["key"]] = _parse_date(v)
        else:
            out[col["key"]] = str(v or "").strip()
    out["activityId"] = out["activityId"] or ""
    out["activityStatus"] = out["activityStatus"] or "Not Started"
    out["priority"] = out["priority"] or "Medium"
    out["materialStatus"] = out["materialStatus"] or "Not Ordered"
    out["materialOwnership"] = _normalize_ownership(out.get("materialOwnership", "")) or "Mechanical"
    out["riskLevel"] = out["riskLevel"] or "Low"
    out["completionPercentage"] = min(100, max(0, _parse_number(out.get("completionPercentage"))))
    out["lastModifiedDate"] = out["lastModifiedDate"] or now_iso_date()
    out["lastModifiedBy"] = out["lastModifiedBy"] or "Planner"
    out["comments"] = merged.get("comments") if isinstance(merged.get("comments"), list) else []
    out["attachments"] = merged.get("attachments") if isinstance(merged.get("attachments"), list) else []
    return out


def generate_activity_id(existing: list) -> str:
    pat = re.compile(r"^ACT-(\d{4,})$")
    mx = 0
    for a in existing:
        aid = (a or {}).get("activityId") or ""
        m = pat.match(aid)
        if m:
            mx = max(mx, int(m.group(1)))
    return f"ACT-{str(mx + 1).zfill(4)}"


def create_sample_dataset() -> list:
    today = now_iso_date()
    sample = [
        {
            "activityId": "ACT-0001",
            "phase": "Preparation",
            "activityName": "Fixture Strategy Freeze",
            "subActivity": "Stakeholder Approval",
            "baseEffortHours": 40,
            "requiredMaterials": "Fixture Frame, Mounting Plate",
            "requiredTools": "CAD Suite, Review Board",
            "materialOwnership": "Mechanical",
            "materialLeadTime": 12,
            "dependencies": "",
            "plannedStartDate": "2026-02-12",
            "plannedEndDate": "2026-02-18",
            "plannedDurationHours": 40,
            "priority": "High",
            "milestone": "Strategy Approved",
            "assignedManpower": 3,
            "manpowerSkillLevel": "Senior",
            "resourceName": "Planning Core Team",
            "resourceDepartment": "Process Engineering",
            "shiftType": "Day",
            "materialStatus": "Received",
            "materialRequiredDate": "2026-02-14",
            "materialReceivedDate": "2026-02-13",
            "materialCriticality": "High",
            "actualStartDate": "2026-02-12",
            "actualEndDate": "",
            "activityStatus": "In Progress",
            "completionPercentage": 90,
            "riskLevel": "Medium",
            "riskScore": 52,
            "delayReason": "",
            "dependencyType": "FS",
            "estimatedCost": 8000,
            "actualCost": 7600,
            "costCenter": "CC-PLN-100",
            "lastModifiedBy": "Planner",
            "lastModifiedDate": today,
            "remarks": "Awaiting final review notes",
        },
        {
            "activityId": "ACT-0002",
            "phase": "Build-Up",
            "activityName": "Third Party Housing Fabrication",
            "subActivity": "Machining and QA",
            "baseEffortHours": 96,
            "requiredMaterials": "Aluminum Housing, Fasteners",
            "requiredTools": "CNC Program, QA Fixture",
            "materialOwnership": "Supplier",
            "materialLeadTime": 48,
            "dependencies": "ACT-0001",
            "plannedStartDate": "2026-02-19",
            "plannedEndDate": "2026-02-26",
            "plannedDurationHours": 96,
            "priority": "Critical",
            "milestone": "Housing Released",
            "assignedManpower": 4,
            "materialStatus": "In Transit",
            "materialRequiredDate": "2026-02-20",
            "materialReceivedDate": "",
            "materialCriticality": "Critical",
            "actualStartDate": "2026-02-20",
            "activityStatus": "Delayed",
            "completionPercentage": 25,
            "riskLevel": "High",
            "riskScore": 78,
            "delayReason": "Vendor heat-treatment queue saturation",
            "dependencyType": "FS",
            "manualOverrideDuration": 8,
            "overrideReason": "Expedite via overtime",
            "overrideApprovedBy": "Operations Lead",
            "estimatedCost": 23000,
            "actualCost": 25000,
            "lastModifiedBy": "Supply Planner",
            "lastModifiedDate": today,
            "remarks": "Daily escalation active",
        },
        {
            "activityId": "ACT-0003",
            "phase": "Validation",
            "activityName": "Integrated Dry Run",
            "subActivity": "Sequence and Interlock Verification",
            "baseEffortHours": 64,
            "requiredMaterials": "Harness Set, Safety Interlock",
            "requiredTools": "Commissioning Toolkit",
            "materialOwnership": "Client",
            "materialLeadTime": 24,
            "dependencies": "ACT-0002",
            "plannedStartDate": "2026-02-27",
            "plannedEndDate": "2026-03-03",
            "plannedDurationHours": 64,
            "priority": "High",
            "materialStatus": "Ordered",
            "materialRequiredDate": "2026-02-28",
            "materialCriticality": "High",
            "activityStatus": "Not Started",
            "completionPercentage": 0,
            "riskLevel": "Medium",
            "riskScore": 46,
            "dependencyType": "FS",
            "estimatedCost": 15000,
            "lastModifiedBy": "Planner",
            "lastModifiedDate": today,
        },
    ]
    return [sanitize_activity(a) for a in sample]
