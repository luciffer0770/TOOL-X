import { normalizePhase, parseDependencies, sanitizeActivity } from "./schema.js";

const HOURS_TO_MS = 60 * 60 * 1000;
const DAY_TO_MS = 24 * HOURS_TO_MS;

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateToIso(date) {
  if (!(date instanceof Date)) return "";
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function diffHours(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  return (endDate.getTime() - startDate.getTime()) / HOURS_TO_MS;
}

export function getPlannedDurationHours(activity) {
  const overrideDuration = toNumber(activity.manualOverrideDuration);
  if (overrideDuration > 0) return overrideDuration;

  const explicitDuration = toNumber(activity.plannedDurationHours);
  if (explicitDuration > 0) return explicitDuration;

  const startDate = parseDate(activity.plannedStartDate);
  const endDate = parseDate(activity.plannedEndDate);
  const derivedFromDates = diffHours(startDate, endDate);
  if (derivedFromDates > 0) return derivedFromDates;

  return Math.max(0, toNumber(activity.baseEffortHours));
}

export function getActualDurationHours(activity, referenceDate = new Date()) {
  const explicitDuration = toNumber(activity.actualDurationHours);
  if (explicitDuration > 0) return explicitDuration;

  const startDate = parseDate(activity.actualStartDate);
  const endDate = parseDate(activity.actualEndDate);
  if (startDate && endDate) {
    return Math.max(0, diffHours(startDate, endDate));
  }

  if (startDate && String(activity.activityStatus).toLowerCase() !== "completed") {
    return Math.max(0, diffHours(startDate, referenceDate));
  }

  return 0;
}

export function getExpectedCompletion(activity, referenceDate = new Date()) {
  const plannedStart = parseDate(activity.plannedStartDate);
  const plannedEnd = parseDate(activity.plannedEndDate);
  if (!plannedStart || !plannedEnd) return 0;

  if (referenceDate <= plannedStart) return 0;
  if (referenceDate >= plannedEnd) return 100;
  const elapsed = diffHours(plannedStart, referenceDate);
  const total = diffHours(plannedStart, plannedEnd);
  if (total <= 0) return 0;
  return clamp((elapsed / total) * 100, 0, 100);
}

function normalizedCompletion(activity) {
  const completion = clamp(toNumber(activity.completionPercentage), 0, 100);
  if (String(activity.activityStatus).toLowerCase() === "completed") return 100;
  if (parseDate(activity.actualEndDate)) return 100;
  return completion;
}

export function getDelayHours(activity, referenceDate = new Date()) {
  const plannedEnd = parseDate(activity.plannedEndDate);
  if (!plannedEnd) return 0;

  const actualEnd = parseDate(activity.actualEndDate);
  if (actualEnd) return Math.max(0, diffHours(plannedEnd, actualEnd));

  const completion = normalizedCompletion(activity);
  if (completion >= 100 || String(activity.activityStatus).toLowerCase() === "completed") {
    return 0;
  }
  return Math.max(0, diffHours(plannedEnd, referenceDate));
}

function priorityWeight(priority) {
  switch (String(priority).toLowerCase()) {
    case "critical":
      return 18;
    case "high":
      return 12;
    case "medium":
      return 7;
    case "low":
      return 3;
    default:
      return 5;
  }
}

function materialRiskWeight(activity) {
  const status = String(activity.materialStatus).toLowerCase();
  const criticality = String(activity.materialCriticality).toLowerCase();
  let score = 0;

  if (status === "delayed") score += 14;
  else if (status === "in transit") score += 8;
  else if (status === "ordered") score += 5;

  if (criticality === "critical") score += 14;
  else if (criticality === "high") score += 8;
  else if (criticality === "medium") score += 4;

  return score;
}

function dependencyRiskWeight(activity) {
  const dependencies = parseDependencies(activity.dependencies);
  const dependencyType = String(activity.dependencyType).toUpperCase();
  const base = clamp(dependencies.length * 4, 0, 20);
  if (!dependencyType) return base;
  if (dependencyType === "SS") return base + 2;
  if (dependencyType === "FF") return base + 1;
  return base;
}

export function deriveRiskLevel(riskScore) {
  if (riskScore >= 75) return "Critical";
  if (riskScore >= 55) return "High";
  if (riskScore >= 30) return "Medium";
  return "Low";
}

export function computeRiskScore(activity, referenceDate = new Date()) {
  const plannedDuration = Math.max(1, getPlannedDurationHours(activity));
  const delayHours = getDelayHours(activity, referenceDate);
  const delayRatio = delayHours / plannedDuration;
  const delayScore = clamp(delayRatio * 45, 0, 40);

  const expectedCompletion = getExpectedCompletion(activity, referenceDate);
  const completion = normalizedCompletion(activity);
  const completionGap = Math.max(0, expectedCompletion - completion);
  const executionScore = clamp(completionGap * 0.35, 0, 20);

  const costVariance = toNumber(activity.actualCost) - toNumber(activity.estimatedCost);
  const costScore = costVariance > 0 ? clamp((costVariance / Math.max(1, toNumber(activity.estimatedCost))) * 15, 0, 10) : 0;

  const score =
    delayScore +
    executionScore +
    priorityWeight(activity.priority) +
    materialRiskWeight(activity) +
    dependencyRiskWeight(activity) +
    costScore;
  return Math.round(clamp(score, 0, 100));
}

export function isDelayed(activity, referenceDate = new Date()) {
  if (String(activity.activityStatus).toLowerCase() === "delayed") return true;
  return getDelayHours(activity, referenceDate) > 0;
}

export function inferStatus(activity, referenceDate = new Date()) {
  const completion = normalizedCompletion(activity);
  if (completion >= 100 || parseDate(activity.actualEndDate)) return "Completed";
  if (isDelayed(activity, referenceDate)) return "Delayed";
  if (parseDate(activity.actualStartDate) || completion > 0) return "In Progress";
  return activity.activityStatus || "Not Started";
}

export function enrichActivity(activity, referenceDate = new Date()) {
  const sanitized = sanitizeActivity(activity);
  const completionPercentage = normalizedCompletion(sanitized);
  const plannedDurationHours = Math.round(getPlannedDurationHours(sanitized) * 100) / 100;
  const actualDurationHours = Math.round(getActualDurationHours(sanitized, referenceDate) * 100) / 100;
  const delayHours = Math.round(getDelayHours(sanitized, referenceDate) * 100) / 100;
  const riskScore = computeRiskScore(
    {
      ...sanitized,
      completionPercentage,
      plannedDurationHours,
      actualDurationHours,
    },
    referenceDate,
  );
  const riskLevel = deriveRiskLevel(riskScore);
  const activityStatus = inferStatus({ ...sanitized, riskScore, riskLevel }, referenceDate);

  return {
    ...sanitized,
    completionPercentage,
    plannedDurationHours,
    actualDurationHours,
    delayHours,
    riskScore,
    riskLevel,
    activityStatus,
  };
}

export function enrichActivities(activities, referenceDate = new Date()) {
  return activities.map((activity) => enrichActivity(activity, referenceDate));
}

export function buildDependencyGraph(activities) {
  const graph = new Map();
  const byId = new Map(activities.map((activity) => [activity.activityId, activity]));

  activities.forEach((activity) => {
    const id = activity.activityId;
    if (!id) return;
    const dependencies = parseDependencies(activity.dependencies).filter((dependencyId) => byId.has(dependencyId));
    graph.set(id, dependencies);
  });

  return graph;
}

export function detectDependencyCycles(activities) {
  const graph = buildDependencyGraph(activities);
  const visited = new Set();
  const visiting = new Set();
  const stack = [];
  const cycleIds = new Set();

  function visit(node) {
    visiting.add(node);
    stack.push(node);

    const dependencies = graph.get(node) ?? [];
    dependencies.forEach((dependencyId) => {
      if (!graph.has(dependencyId)) return;
      if (visiting.has(dependencyId)) {
        const cycleStart = stack.indexOf(dependencyId);
        if (cycleStart >= 0) {
          for (let index = cycleStart; index < stack.length; index += 1) {
            cycleIds.add(stack[index]);
          }
        }
        cycleIds.add(dependencyId);
        return;
      }
      if (!visited.has(dependencyId)) {
        visit(dependencyId);
      }
    });

    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  graph.forEach((_, node) => {
    if (!visited.has(node)) visit(node);
  });

  return cycleIds;
}

export function getDependencyHealth(activities) {
  const sanitized = activities.map((activity) => sanitizeActivity(activity));
  const activityIds = new Set(sanitized.map((activity) => activity.activityId).filter(Boolean));
  const missingByActivity = {};
  let missingDependencyLinks = 0;

  sanitized.forEach((activity) => {
    const missing = parseDependencies(activity.dependencies).filter((dependencyId) => !activityIds.has(dependencyId));
    if (!missing.length) return;
    missingByActivity[activity.activityId] = missing;
    missingDependencyLinks += missing.length;
  });

  const cycleIds = detectDependencyCycles(sanitized);

  return {
    missingByActivity,
    missingDependencyLinks,
    activitiesWithMissingDependencies: Object.keys(missingByActivity).length,
    cycleActivityIds: [...cycleIds],
    cycleCount: cycleIds.size,
  };
}

export function topologicalSort(activities) {
  const graph = buildDependencyGraph(activities);
  const inDegree = new Map();
  const adjacency = new Map();

  graph.forEach((dependencies, id) => {
    if (!inDegree.has(id)) inDegree.set(id, 0);
    if (!adjacency.has(id)) adjacency.set(id, []);
    dependencies.forEach((dependency) => {
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      if (!adjacency.has(dependency)) adjacency.set(dependency, []);
      adjacency.get(dependency).push(id);
    });
  });

  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const ordered = [];
  while (queue.length) {
    const node = queue.shift();
    ordered.push(node);
    (adjacency.get(node) ?? []).forEach((neighbor) => {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    });
  }

  if (ordered.length < inDegree.size) {
    // Graceful fallback when cycles exist: append unsorted nodes.
    inDegree.forEach((_, id) => {
      if (!ordered.includes(id)) ordered.push(id);
    });
  }
  return ordered;
}

export function getCriticalPath(activities) {
  const enriched = enrichActivities(activities);
  const byId = new Map(enriched.map((activity) => [activity.activityId, activity]));
  const graph = buildDependencyGraph(enriched);
  const order = topologicalSort(enriched);
  const finishTimes = new Map();
  const predecessor = new Map();

  order.forEach((activityId) => {
    const activity = byId.get(activityId);
    if (!activity) return;
    const dependencies = graph.get(activityId) ?? [];
    let bestFinish = 0;
    let bestDependency = null;
    dependencies.forEach((dependencyId) => {
      const dependencyFinish = finishTimes.get(dependencyId) ?? 0;
      if (dependencyFinish > bestFinish) {
        bestFinish = dependencyFinish;
        bestDependency = dependencyId;
      }
    });

    const finish = bestFinish + getPlannedDurationHours(activity);
    finishTimes.set(activityId, finish);
    predecessor.set(activityId, bestDependency);
  });

  let terminalNode = null;
  let longestFinish = 0;
  finishTimes.forEach((finish, activityId) => {
    if (finish > longestFinish) {
      longestFinish = finish;
      terminalNode = activityId;
    }
  });

  const path = [];
  let cursor = terminalNode;
  while (cursor) {
    path.push(cursor);
    cursor = predecessor.get(cursor) ?? null;
  }

  path.reverse();
  return {
    path,
    durationHours: Math.round(longestFinish),
  };
}

export function getBlockedActivities(activities) {
  const byId = new Map(activities.map((activity) => [activity.activityId, activity]));
  return activities
    .filter((activity) => {
      const dependencies = parseDependencies(activity.dependencies);
      if (!dependencies.length) return false;
      return dependencies.some((dependencyId) => {
        const parent = byId.get(dependencyId);
        if (!parent) return false;
        return String(parent.activityStatus).toLowerCase() !== "completed";
      });
    })
    .map((activity) => ({
      ...activity,
      blockingDependencies: parseDependencies(activity.dependencies).filter((dependencyId) => {
        const parent = byId.get(dependencyId);
        if (!parent) return false;
        return String(parent.activityStatus).toLowerCase() !== "completed";
      }),
    }));
}

export function computePortfolioMetrics(activities, referenceDate = new Date()) {
  const enriched = enrichActivities(activities, referenceDate);
  const delayed = enriched.filter((activity) => isDelayed(activity, referenceDate)).length;
  const completed = enriched.filter((activity) => String(activity.activityStatus).toLowerCase() === "completed").length;
  const inProgress = enriched.filter((activity) => String(activity.activityStatus).toLowerCase() === "in progress").length;
  const blocked = enriched.filter((activity) => String(activity.activityStatus).toLowerCase() === "blocked").length;
  const highRisk = enriched.filter((activity) => activity.riskScore >= 55).length;
  const avgCompletion =
    enriched.length > 0
      ? Math.round((enriched.reduce((sum, activity) => sum + toNumber(activity.completionPercentage), 0) / enriched.length) * 10) / 10
      : 0;

  const estimatedCost = enriched.reduce((sum, activity) => sum + toNumber(activity.estimatedCost), 0);
  const actualCost = enriched.reduce((sum, activity) => sum + toNumber(activity.actualCost), 0);
  const criticalPath = getCriticalPath(enriched);
  const blockedActivities = getBlockedActivities(enriched);

  return {
    totalActivities: enriched.length,
    delayed,
    completed,
    inProgress,
    blocked,
    highRisk,
    avgCompletion,
    estimatedCost,
    actualCost,
    costVariance: actualCost - estimatedCost,
    criticalPath,
    blockedActivities,
    enriched,
  };
}

function materialWaitPenaltyHours(activity, leadReductionPct = 0) {
  const status = String(activity.materialStatus).toLowerCase();
  if (status === "received") return 0;
  const leadTimeHours = Math.max(0, toNumber(activity.materialLeadTime));
  const reduced = leadTimeHours * (1 - clamp(leadReductionPct, 0, 100) / 100);
  return reduced;
}

function adjustedDurationHours(activity, scenario) {
  const baseDuration = Math.max(1, getPlannedDurationHours(activity));
  const manpowerBoostPct = clamp(toNumber(scenario.manpowerBoostPct), 0, 100);
  const overtimeHoursPerDay = clamp(toNumber(scenario.overtimeHoursPerDay), 0, 12);
  const leadReductionPct = clamp(toNumber(scenario.leadTimeReductionPct), 0, 100);

  const manpowerLevel = Math.max(1, toNumber(activity.assignedManpower));
  const efficiencyGain = (manpowerBoostPct / 100) * Math.min(1.5, manpowerLevel / 4);
  const manpowerAdjusted = baseDuration / (1 + efficiencyGain);

  const overtimeGain = overtimeHoursPerDay * Math.max(1, manpowerAdjusted / 8) * 0.35;
  const productionAdjusted = Math.max(1, manpowerAdjusted - overtimeGain);

  const materialPenalty = materialWaitPenaltyHours(activity, leadReductionPct);
  return productionAdjusted + materialPenalty;
}

function scheduleByDependencies(activities, scenario) {
  const enriched = enrichActivities(activities);
  const byId = new Map(enriched.map((activity) => [activity.activityId, activity]));
  const order = topologicalSort(enriched);
  const finishById = new Map();

  const plannedStarts = enriched.map((activity) => parseDate(activity.plannedStartDate)).filter(Boolean);
  const fallbackStart = plannedStarts.length ? new Date(Math.min(...plannedStarts.map((date) => date.getTime()))) : new Date();

  const rows = [];
  order.forEach((activityId) => {
    const activity = byId.get(activityId);
    if (!activity) return;

    const dependencyFinishes = parseDependencies(activity.dependencies)
      .map((dependencyId) => finishById.get(dependencyId))
      .filter(Boolean);

    const dependencyGate = dependencyFinishes.length
      ? new Date(Math.max(...dependencyFinishes.map((date) => date.getTime())))
      : fallbackStart;
    const plannedStart = parseDate(activity.plannedStartDate) ?? fallbackStart;
    const start = new Date(Math.max(plannedStart.getTime(), dependencyGate.getTime()));
    const durationHours = adjustedDurationHours(activity, scenario);
    const finish = new Date(start.getTime() + durationHours * HOURS_TO_MS);

    finishById.set(activityId, finish);
    rows.push({
      activityId,
      activityName: activity.activityName,
      startDate: dateToIso(start),
      finishDate: dateToIso(finish),
      durationHours: Math.round(durationHours * 10) / 10,
    });
  });

  const finishDates = [...finishById.values()];
  const projectFinish = finishDates.length ? new Date(Math.max(...finishDates.map((date) => date.getTime()))) : null;
  return {
    rows,
    projectFinish,
  };
}

export function runScenarioSimulation(activities, scenario) {
  const baseline = scheduleByDependencies(activities, {
    manpowerBoostPct: 0,
    overtimeHoursPerDay: 0,
    leadTimeReductionPct: 0,
  });
  const simulated = scheduleByDependencies(activities, scenario);

  const baselineById = new Map(baseline.rows.map((row) => [row.activityId, row]));
  const impactRows = simulated.rows
    .map((row) => {
      const baselineRow = baselineById.get(row.activityId);
      if (!baselineRow) return null;
      const savedHours = Math.round((baselineRow.durationHours - row.durationHours) * 10) / 10;
      return {
        ...row,
        baselineDurationHours: baselineRow.durationHours,
        savedHours,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.savedHours - left.savedHours);

  const baselineFinish = baseline.projectFinish;
  const simulatedFinish = simulated.projectFinish;
  const improvementHours =
    baselineFinish && simulatedFinish ? Math.round(diffHours(simulatedFinish, baselineFinish) * -10) / 10 : 0;

  return {
    baselineFinishDate: dateToIso(baselineFinish),
    simulatedFinishDate: dateToIso(simulatedFinish),
    improvementHours,
    impacts: impactRows,
  };
}

export function groupBy(items, mapper) {
  return items.reduce((accumulator, item) => {
    const key = mapper(item);
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

export function getMaterialHealth(activities, referenceDate = new Date()) {
  const enriched = enrichActivities(activities, referenceDate);
  const ownershipCounts = groupBy(enriched, (activity) => activity.materialOwnership || "Unspecified");
  const statusCounts = groupBy(enriched, (activity) => activity.materialStatus || "Unspecified");
  const departmentCounts = groupBy(enriched, (activity) => activity.resourceDepartment || "Unassigned");

  const pendingCritical = enriched.filter((activity) => {
    const criticality = String(activity.materialCriticality).toLowerCase();
    const status = String(activity.materialStatus).toLowerCase();
    return (criticality === "critical" || criticality === "high") && status !== "received";
  });

  const lateMaterials = enriched.filter((activity) => {
    const required = parseDate(activity.materialRequiredDate);
    const received = parseDate(activity.materialReceivedDate);
    if (!required) return false;
    if (received) return received > required;
    return required < referenceDate;
  });

  return {
    ownershipCounts,
    statusCounts,
    departmentCounts,
    pendingCritical,
    lateMaterials,
    enriched,
  };
}

export function getDelayAndRiskRows(activities, referenceDate = new Date()) {
  return enrichActivities(activities, referenceDate)
    .filter((activity) => isDelayed(activity, referenceDate) || activity.riskScore >= 55)
    .sort((left, right) => right.riskScore - left.riskScore);
}

function anomalySeverityRank(severity) {
  const normalized = String(severity).toLowerCase();
  if (normalized === "critical") return 4;
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  return 1;
}

export function getAnomalyRows(activities, referenceDate = new Date()) {
  const sanitized = activities.map((activity) => sanitizeActivity(activity));
  const dependencyHealth = getDependencyHealth(sanitized);
  const cycleSet = new Set(dependencyHealth.cycleActivityIds);
  const rows = [];

  sanitized.forEach((activity) => {
    const activityId = activity.activityId || "UNKNOWN";
    const activityName = activity.activityName || "-";
    const completion = clamp(toNumber(activity.completionPercentage), 0, 100);
    const status = String(activity.activityStatus || "").toLowerCase();
    const start = parseDate(activity.actualStartDate);
    const end = parseDate(activity.actualEndDate);
    const delayedWithoutReason = isDelayed(activity, referenceDate) && !String(activity.delayReason || "").trim();
    const missingDependencies = dependencyHealth.missingByActivity[activity.activityId] ?? [];

    if (status === "completed" && completion < 100) {
      rows.push({
        ruleId: "completed_without_full_completion",
        activityId,
        activityName,
        severity: "High",
        issue: "Completed status but completion is below 100%",
        details: `Completion is ${completion}%.`,
        recommendation: "Set completion to 100% or correct the status.",
      });
    }

    if (start && end && end < start) {
      rows.push({
        ruleId: "actual_end_before_start",
        activityId,
        activityName,
        severity: "Critical",
        issue: "Actual end date is before actual start date",
        details: `${dateToIso(end)} is earlier than ${dateToIso(start)}.`,
        recommendation: "Correct actual start/end dates before reporting progress.",
      });
    }

    if (delayedWithoutReason) {
      rows.push({
        ruleId: "delayed_without_root_cause",
        activityId,
        activityName,
        severity: "High",
        issue: "Delayed activity has no root cause",
        details: "Delay reason field is blank.",
        recommendation: "Capture root cause and mitigation action.",
      });
    }

    if (missingDependencies.length) {
      rows.push({
        ruleId: "missing_dependency_reference",
        activityId,
        activityName,
        severity: "Critical",
        issue: "Missing dependency references detected",
        details: `Unknown dependency IDs: ${missingDependencies.join(", ")}.`,
        recommendation: "Correct dependency IDs or add missing predecessor activities.",
      });
    }

    if (cycleSet.has(activity.activityId)) {
      rows.push({
        ruleId: "dependency_cycle_detected",
        activityId,
        activityName,
        severity: "Critical",
        issue: "Dependency cycle detected",
        details: "Activity participates in a circular dependency loop.",
        recommendation: "Break the cycle by revising predecessor links.",
      });
    }

    if (String(activity.materialStatus).toLowerCase() === "received" && !parseDate(activity.materialReceivedDate)) {
      rows.push({
        ruleId: "received_without_date",
        activityId,
        activityName,
        severity: "Medium",
        issue: "Material marked received without received date",
        details: "Material status is Received but materialReceivedDate is empty.",
        recommendation: "Enter the material received date for traceability.",
      });
    }
  });

  return rows.sort((left, right) => {
    const severityDelta = anomalySeverityRank(right.severity) - anomalySeverityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;
    return String(left.activityId).localeCompare(String(right.activityId));
  });
}

export function getPhaseProgress(activities) {
  const enriched = enrichActivities(activities);
  const buckets = {};
  enriched.forEach((activity) => {
    const phase = normalizePhase(activity.phase) || "Unassigned";
    if (!buckets[phase]) {
      buckets[phase] = {
        count: 0,
        completion: 0,
        delayed: 0,
      };
    }
    buckets[phase].count += 1;
    buckets[phase].completion += toNumber(activity.completionPercentage);
    if (isDelayed(activity)) buckets[phase].delayed += 1;
  });

  return Object.entries(buckets).map(([phase, value]) => ({
    phase,
    activityCount: value.count,
    avgCompletion: value.count ? Math.round((value.completion / value.count) * 10) / 10 : 0,
    delayedActivities: value.delayed,
  }));
}

export function getTimelineBounds(activities) {
  const enriched = enrichActivities(activities);
  const startDates = [];
  const endDates = [];
  enriched.forEach((activity) => {
    const start = parseDate(activity.plannedStartDate) || parseDate(activity.actualStartDate);
    const end = parseDate(activity.plannedEndDate) || parseDate(activity.actualEndDate);
    if (start) startDates.push(start);
    if (end) endDates.push(end);
    if (start && !end) {
      const durationHours = getPlannedDurationHours(activity);
      endDates.push(new Date(start.getTime() + durationHours * HOURS_TO_MS));
    }
  });

  if (!startDates.length || !endDates.length) {
    const now = new Date();
    return {
      min: new Date(now.getTime() - 3 * DAY_TO_MS),
      max: new Date(now.getTime() + 14 * DAY_TO_MS),
    };
  }

  const min = new Date(Math.min(...startDates.map((date) => date.getTime())));
  const max = new Date(Math.max(...endDates.map((date) => date.getTime())));
  return {
    min: new Date(min.getTime() - DAY_TO_MS),
    max: new Date(max.getTime() + DAY_TO_MS),
  };
}
