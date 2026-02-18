const nowIsoDate = () => new Date().toISOString().slice(0, 10);

export const COLUMN_SCHEMA = [
  { key: "activityId", label: "Activity ID", type: "text", requiredImport: true },
  { key: "phase", label: "Phase", type: "text", requiredImport: true },
  { key: "activityName", label: "Activity Name", type: "text", requiredImport: true },
  { key: "subActivity", label: "Sub Activity", type: "text", requiredImport: true },
  { key: "baseEffortHours", label: "Base Effort Hours", type: "number", requiredImport: true },
  { key: "requiredMaterials", label: "Required Materials", type: "text", requiredImport: true },
  { key: "requiredTools", label: "Required Tools", type: "text", requiredImport: true },
  { key: "materialOwnership", label: "Material Ownership", type: "text", requiredImport: true },
  { key: "materialLeadTime", label: "Material Lead Time", type: "number", requiredImport: true },
  { key: "dependencies", label: "Dependencies", type: "text", requiredImport: true },
  { key: "plannedStartDate", label: "Planned Start Date", type: "date" },
  { key: "plannedEndDate", label: "Planned End Date", type: "date" },
  { key: "plannedDurationHours", label: "Planned Duration Hours", type: "number" },
  { key: "priority", label: "Priority", type: "text" },
  { key: "milestone", label: "Milestone", type: "text" },
  { key: "assignedManpower", label: "Assigned Manpower", type: "number" },
  { key: "manpowerSkillLevel", label: "Manpower Skill Level", type: "text" },
  { key: "resourceName", label: "Resource Name", type: "text" },
  { key: "resourceDepartment", label: "Resource Department", type: "text" },
  { key: "shiftType", label: "Shift Type", type: "text" },
  { key: "materialStatus", label: "Material Status", type: "text" },
  { key: "materialRequiredDate", label: "Material Required Date", type: "date" },
  { key: "materialReceivedDate", label: "Material Received Date", type: "date" },
  { key: "materialCriticality", label: "Material Criticality", type: "text" },
  { key: "actualStartDate", label: "Actual Start Date", type: "date" },
  { key: "actualEndDate", label: "Actual End Date", type: "date" },
  { key: "actualDurationHours", label: "Actual Duration Hours", type: "number" },
  { key: "activityStatus", label: "Activity Status", type: "text" },
  { key: "completionPercentage", label: "Completion Percentage", type: "number" },
  { key: "riskLevel", label: "Risk Level", type: "text" },
  { key: "riskScore", label: "Risk Score", type: "number" },
  { key: "delayReason", label: "Delay Reason", type: "text" },
  { key: "dependencyType", label: "Dependency Type", type: "text" },
  { key: "manualOverrideDuration", label: "Manual Override Duration", type: "number" },
  { key: "overrideReason", label: "Override Reason", type: "text" },
  { key: "overrideApprovedBy", label: "Override Approved By", type: "text" },
  { key: "estimatedCost", label: "Estimated Cost", type: "number" },
  { key: "actualCost", label: "Actual Cost", type: "number" },
  { key: "costCenter", label: "Cost Center", type: "text" },
  { key: "lastModifiedBy", label: "Last Modified By", type: "text" },
  { key: "lastModifiedDate", label: "Last Modified Date", type: "date" },
  { key: "remarks", label: "Remarks", type: "text" },
];

export const IMPORT_REQUIRED_KEYS = COLUMN_SCHEMA.filter((column) => column.requiredImport).map((column) => column.key);
export const IMPORT_REQUIRED_LABELS = COLUMN_SCHEMA.filter((column) => column.requiredImport).map((column) => column.label);

export const ACTIVITY_STATUSES = ["Not Started", "In Progress", "Blocked", "Delayed", "Completed"];
export const PRIORITY_LEVELS = ["Low", "Medium", "High", "Critical"];
export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];
export const MATERIAL_STATUSES = ["Not Ordered", "Ordered", "In Transit", "Received", "Delayed"];
export const OWNERSHIP_TYPES = ["Client", "Internal Team", "Supplier"];

const headerToColumn = new Map();

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function parseDate(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const direct = value.trim();
    if (!direct) return "";
    const parsed = new Date(direct);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalizeOwnership(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "";

  const normalized = rawValue.toLowerCase();
  if (normalized.includes("internal")) return "Internal Team";
  if (normalized.includes("third") || normalized.includes("supplier") || normalized.includes("vendor")) return "Supplier";
  if (normalized.includes("client") || normalized.includes("customer") || normalized.includes("joint")) return "Client";

  const known = OWNERSHIP_TYPES.find((entry) => entry.toLowerCase() === normalized);
  return known || rawValue;
}

export function getColumnByHeader(header) {
  return headerToColumn.get(normalizeHeader(header));
}

export function getColumnByKey(key) {
  return COLUMN_SCHEMA.find((column) => column.key === key);
}

export function parseDependencies(rawDependencies) {
  if (!rawDependencies) return [];
  return String(rawDependencies)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function createEmptyActivity() {
  const activity = {};
  COLUMN_SCHEMA.forEach((column) => {
    if (column.type === "number") {
      activity[column.key] = 0;
    } else {
      activity[column.key] = "";
    }
  });

  activity.activityStatus = "Not Started";
  activity.completionPercentage = 0;
  activity.priority = "Medium";
  activity.riskLevel = "Low";
  activity.materialStatus = "Not Ordered";
  activity.lastModifiedDate = nowIsoDate();
  activity.lastModifiedBy = "Planner";
  return activity;
}

export function sanitizeActivity(rawActivity) {
  const merged = { ...createEmptyActivity(), ...(rawActivity ?? {}) };
  const sanitized = {};

  COLUMN_SCHEMA.forEach((column) => {
    const rawValue = merged[column.key];
    if (column.type === "number") {
      sanitized[column.key] = parseNumber(rawValue);
      return;
    }
    if (column.type === "date") {
      sanitized[column.key] = parseDate(rawValue);
      return;
    }
    sanitized[column.key] = String(rawValue ?? "").trim();
  });

  sanitized.activityId = sanitized.activityId || "";
  sanitized.activityStatus = sanitized.activityStatus || "Not Started";
  sanitized.priority = sanitized.priority || "Medium";
  sanitized.materialStatus = sanitized.materialStatus || "Not Ordered";
  sanitized.materialOwnership = normalizeOwnership(sanitized.materialOwnership);
  sanitized.riskLevel = sanitized.riskLevel || "Low";
  sanitized.completionPercentage = Math.min(100, Math.max(0, parseNumber(sanitized.completionPercentage)));
  sanitized.lastModifiedDate = sanitized.lastModifiedDate || nowIsoDate();
  sanitized.lastModifiedBy = sanitized.lastModifiedBy || "Planner";
  return sanitized;
}

export function mapRowToActivity(row) {
  const draft = createEmptyActivity();
  Object.entries(row).forEach(([header, value]) => {
    const column = getColumnByHeader(header);
    if (!column) return;
    draft[column.key] = value;
  });
  return sanitizeActivity(draft);
}

export function generateActivityId(existingActivities) {
  const pattern = /^ACT-(\d{4,})$/;
  let max = 0;
  existingActivities.forEach((activity) => {
    const match = pattern.exec(activity.activityId || "");
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });
  return `ACT-${String(max + 1).padStart(4, "0")}`;
}

export function createSampleDataset() {
  const sample = [
    {
      activityId: "ACT-0001",
      phase: "Preparation",
      activityName: "Fixture Strategy Freeze",
      subActivity: "Stakeholder Approval",
      baseEffortHours: 40,
      requiredMaterials: "Fixture Frame, Mounting Plate",
      requiredTools: "CAD Suite, Review Board",
      materialOwnership: "Internal Team",
      materialLeadTime: 12,
      dependencies: "",
      plannedStartDate: "2026-02-12",
      plannedEndDate: "2026-02-18",
      plannedDurationHours: 40,
      priority: "High",
      milestone: "Strategy Approved",
      assignedManpower: 3,
      manpowerSkillLevel: "Senior",
      resourceName: "Planning Core Team",
      resourceDepartment: "Process Engineering",
      shiftType: "Day",
      materialStatus: "Received",
      materialRequiredDate: "2026-02-14",
      materialReceivedDate: "2026-02-13",
      materialCriticality: "High",
      actualStartDate: "2026-02-12",
      actualEndDate: "",
      actualDurationHours: 36,
      activityStatus: "In Progress",
      completionPercentage: 90,
      riskLevel: "Medium",
      riskScore: 52,
      delayReason: "",
      dependencyType: "FS",
      manualOverrideDuration: 0,
      overrideReason: "",
      overrideApprovedBy: "",
      estimatedCost: 8000,
      actualCost: 7600,
      costCenter: "CC-PLN-100",
      lastModifiedBy: "Planner",
      lastModifiedDate: nowIsoDate(),
      remarks: "Awaiting final review notes",
    },
    {
      activityId: "ACT-0002",
      phase: "Build-Up",
      activityName: "Third Party Housing Fabrication",
      subActivity: "Machining and QA",
      baseEffortHours: 96,
      requiredMaterials: "Aluminum Housing, Fasteners",
      requiredTools: "CNC Program, QA Fixture",
      materialOwnership: "Supplier",
      materialLeadTime: 48,
      dependencies: "ACT-0001",
      plannedStartDate: "2026-02-19",
      plannedEndDate: "2026-02-26",
      plannedDurationHours: 96,
      priority: "Critical",
      milestone: "Housing Released",
      assignedManpower: 4,
      manpowerSkillLevel: "Expert",
      resourceName: "Fabrication Vendor A",
      resourceDepartment: "External Supply",
      shiftType: "Day/Night",
      materialStatus: "In Transit",
      materialRequiredDate: "2026-02-20",
      materialReceivedDate: "",
      materialCriticality: "Critical",
      actualStartDate: "2026-02-20",
      actualEndDate: "",
      actualDurationHours: 28,
      activityStatus: "Delayed",
      completionPercentage: 25,
      riskLevel: "High",
      riskScore: 78,
      delayReason: "Vendor heat-treatment queue saturation",
      dependencyType: "FS",
      manualOverrideDuration: 8,
      overrideReason: "Expedite via overtime",
      overrideApprovedBy: "Operations Lead",
      estimatedCost: 23000,
      actualCost: 25000,
      costCenter: "CC-BLD-240",
      lastModifiedBy: "Supply Planner",
      lastModifiedDate: nowIsoDate(),
      remarks: "Daily escalation active",
    },
    {
      activityId: "ACT-0003",
      phase: "Validation",
      activityName: "Integrated Dry Run",
      subActivity: "Sequence and Interlock Verification",
      baseEffortHours: 64,
      requiredMaterials: "Harness Set, Safety Interlock",
      requiredTools: "Commissioning Toolkit",
      materialOwnership: "Client",
      materialLeadTime: 24,
      dependencies: "ACT-0002",
      plannedStartDate: "2026-02-27",
      plannedEndDate: "2026-03-03",
      plannedDurationHours: 64,
      priority: "High",
      milestone: "Dry Run Complete",
      assignedManpower: 5,
      manpowerSkillLevel: "Mixed",
      resourceName: "Validation Squad",
      resourceDepartment: "Testing",
      shiftType: "Day",
      materialStatus: "Ordered",
      materialRequiredDate: "2026-02-28",
      materialReceivedDate: "",
      materialCriticality: "High",
      actualStartDate: "",
      actualEndDate: "",
      actualDurationHours: 0,
      activityStatus: "Not Started",
      completionPercentage: 0,
      riskLevel: "Medium",
      riskScore: 46,
      delayReason: "",
      dependencyType: "FS",
      manualOverrideDuration: 0,
      overrideReason: "",
      overrideApprovedBy: "",
      estimatedCost: 15000,
      actualCost: 0,
      costCenter: "CC-VAL-320",
      lastModifiedBy: "Planner",
      lastModifiedDate: nowIsoDate(),
      remarks: "Start depends on ACT-0002 release",
    },
  ];
  return sample.map(sanitizeActivity);
}

COLUMN_SCHEMA.forEach((column) => {
  headerToColumn.set(normalizeHeader(column.label), column);
  headerToColumn.set(normalizeHeader(column.key), column);
});

[
  ["subactivity", "subActivity"],
  ["activityid", "activityId"],
  ["base effort", "baseEffortHours"],
  ["material lead time days", "materialLeadTime"],
  ["planned duration", "plannedDurationHours"],
  ["actual duration", "actualDurationHours"],
  ["completion", "completionPercentage"],
  ["risk", "riskScore"],
].forEach(([alias, key]) => {
  const column = getColumnByKey(key);
  if (column) {
    headerToColumn.set(normalizeHeader(alias), column);
  }
});
