import { enrichActivities, getCriticalPath, getDependencyHealth, getTimelineBounds, parseDate } from "./analytics.js";
import { escapeHtml, formatDate, formatHours, notify, renderEmptyState, setActiveNavigation, statusClass } from "./common.js";
import { getActivities, subscribeToStateChanges } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { normalizePhase } from "./schema.js";

const dom = {
  phaseFilter: document.querySelector("#phase-filter"),
  statusFilter: document.querySelector("#status-filter"),
  rangeStart: document.querySelector("#range-start"),
  rangeEnd: document.querySelector("#range-end"),
  sortMode: document.querySelector("#sort-mode"),
  zoomMode: document.querySelector("#zoom-mode"),
  applyButton: document.querySelector("#apply-filters-btn"),
  resetRangeButton: document.querySelector("#reset-range-btn"),
  todayButton: document.querySelector("#today-btn"),
  ganttGrid: document.querySelector("#gantt-grid"),
  ganttSummary: document.querySelector("#gantt-summary"),
  dependencyBody: document.querySelector("#dependency-table-body"),
};

let activities = [];
let bounds = getTimelineBounds([]);
let dependencyHealth = getDependencyHealth([]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getZoomDays() {
  const zoom = dom.zoomMode?.value || "week";
  if (zoom === "day") return 7;
  if (zoom === "month") return 60;
  return 21;
}

function populateFilters() {
  const phaseValues = [...new Set(activities.map((a) => normalizePhase(a.phase)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  dom.phaseFilter.innerHTML = ['<option value="">All</option>']
    .concat(phaseValues.map((phase) => `<option value="${escapeHtml(phase)}">${escapeHtml(phase)}</option>`))
    .join("");

  const statusValues = [...new Set(activities.map((activity) => activity.activityStatus).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  dom.statusFilter.innerHTML = ['<option value="">All</option>']
    .concat(statusValues.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`))
    .join("");
}

function sortRows(rows) {
  switch (dom.sortMode.value) {
    case "risk":
      return rows.sort((left, right) => right.riskScore - left.riskScore);
    case "delay":
      return rows.sort((left, right) => right.delayHours - left.delayHours);
    case "completion":
      return rows.sort((left, right) => right.completionPercentage - left.completionPercentage);
    default:
      return rows.sort((left, right) => String(left.plannedStartDate || "").localeCompare(String(right.plannedStartDate || "")));
  }
}

function activeRange() {
  const start = parseDate(dom.rangeStart.value) || bounds.min;
  const end = parseDate(dom.rangeEnd.value) || bounds.max;
  if (end <= start) {
    notify("Timeline 'To' date must be after 'From' date.", "warning");
    return { start: bounds.min, end: bounds.max };
  }
  return { start, end };
}

function renderGantt() {
  const { start, end } = activeRange();
  const phaseFilter = dom.phaseFilter.value;
  const statusFilter = dom.statusFilter.value;
  const spanMs = end.getTime() - start.getTime();
  const criticalPath = getCriticalPath(activities);
  const criticalSet = new Set(criticalPath.path);

  const rows = sortRows(
    activities
      .filter((activity) => !phaseFilter || normalizePhase(activity.phase) === phaseFilter)
      .filter((activity) => !statusFilter || activity.activityStatus === statusFilter),
  );

  const dependencyIssueCount = dependencyHealth.activitiesWithMissingDependencies + dependencyHealth.cycleCount;
  dom.ganttSummary.textContent = `${rows.length} activities shown | Window ${formatDate(start)} to ${formatDate(end)} | Critical chain ${criticalPath.path.length} nodes | Dependency issues ${dependencyIssueCount}`;

  if (!rows.length) {
    renderEmptyState(
      dom.ganttGrid,
      "No activities match the selected filters.",
      "Try adjusting Phase/Status filters or the date range.",
    );
    renderDependencyTable([]);
    return;
  }

  const today = new Date();
  const todayPct =
    today >= start && today <= end ? ((today.getTime() - start.getTime()) / spanMs) * 100 : null;
  const todayMarkerHtml =
    todayPct != null ? `<div class="gantt-today-marker" style="left:${todayPct}%" aria-hidden="true"></div>` : "";

  const html = [];
  rows.forEach((activity) => {
    const startDate = parseDate(activity.actualStartDate) || parseDate(activity.plannedStartDate) || start;
    const endDate =
      parseDate(activity.actualEndDate) ||
      parseDate(activity.plannedEndDate) ||
      new Date(startDate.getTime() + Math.max(1, activity.plannedDurationHours || activity.baseEffortHours) * 60 * 60 * 1000);

    if (endDate < start || startDate > end) return;

    const clampedStart = new Date(Math.max(startDate.getTime(), start.getTime()));
    const clampedEnd = new Date(Math.min(endDate.getTime(), end.getTime()));
    const leftPct = ((clampedStart.getTime() - start.getTime()) / spanMs) * 100;
    const widthPct = Math.max(1, ((clampedEnd.getTime() - clampedStart.getTime()) / spanMs) * 100);
    const progressPct = Math.max(0, Math.min(100, Number(activity.completionPercentage) || 0));
    const delayed = activity.delayHours > 0 || String(activity.activityStatus).toLowerCase() === "delayed";

    html.push(`
      <div class="gantt-label-cell">
        <div class="gantt-label-title">${escapeHtml(activity.activityId)} - ${escapeHtml(activity.activityName || "Unnamed")}</div>
        <div class="gantt-label-meta">
          ${escapeHtml(activity.phase || "-")} | ${escapeHtml(activity.activityStatus || "-")} | Delay ${Math.round(activity.delayHours)}h
        </div>
      </div>
      <div class="gantt-track">
        ${todayMarkerHtml}
        <div
          class="gantt-bar ${delayed ? "is-delayed" : ""} ${criticalSet.has(activity.activityId) ? "is-critical" : ""}"
          style="left:${leftPct}%; width:${widthPct}%"
        >
          <div class="gantt-progress" style="width:${progressPct}%"></div>
          <div class="gantt-caption">${escapeHtml(activity.activityId)} (${progressPct}%)</div>
        </div>
      </div>
    `);
  });

  if (!html.length) {
    renderEmptyState(
      dom.ganttGrid,
      "No activities fall inside the selected date window.",
      "Try adjusting the From/To dates or Zoom level.",
    );
    renderDependencyTable(rows);
    return;
  }

  dom.ganttGrid.innerHTML = html.join("");
  renderDependencyTable(rows);
}

function renderDependencyTable(rows) {
  const dependencyRows = rows.filter((activity) => String(activity.dependencies || "").trim());
  if (!dependencyRows.length) {
    dom.dependencyBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No dependency relationships found.</div></td></tr>`;
    return;
  }

  dom.dependencyBody.innerHTML = dependencyRows
    .sort((left, right) => right.riskScore - left.riskScore)
    .map(
      (activity) => `
      <tr>
        <td><strong>${escapeHtml(activity.activityId)}</strong><br /><span class="small">${escapeHtml(activity.activityName || "-")}</span></td>
        <td>${escapeHtml(activity.dependencies)}</td>
        <td>${escapeHtml(activity.dependencyType || "FS")}</td>
        <td><span class="${statusClass(activity.activityStatus)}">${escapeHtml(activity.activityStatus || "-")}</span></td>
        <td>${formatHours(activity.delayHours)}</td>
        <td><span class="${statusClass(activity.riskLevel)}">${escapeHtml(activity.riskLevel)} (${activity.riskScore})</span></td>
        <td>${renderDependencyHealth(activity)}</td>
      </tr>
    `,
    )
    .join("");
}

function renderDependencyHealth(activity) {
  const missing = dependencyHealth.missingByActivity[activity.activityId] ?? [];
  const hasCycle = dependencyHealth.cycleActivityIds.includes(activity.activityId);
  const signals = [];
  if (missing.length) {
    signals.push(`<span class="${statusClass("critical")}">Missing: ${escapeHtml(missing.join(", "))}</span>`);
  }
  if (hasCycle) {
    signals.push(`<span class="${statusClass("critical")}">Cycle detected</span>`);
  }
  if (!signals.length) {
    signals.push(`<span class="${statusClass("completed")}">Validated</span>`);
  }
  return signals.join("<br />");
}

function wireEvents() {
  dom.applyButton.addEventListener("click", renderGantt);
  dom.resetRangeButton.addEventListener("click", () => {
    dom.rangeStart.value = bounds.min.toISOString().slice(0, 10);
    dom.rangeEnd.value = bounds.max.toISOString().slice(0, 10);
    renderGantt();
  });
  dom.todayButton?.addEventListener("click", () => {
    const today = new Date();
    const days = getZoomDays();
    const start = new Date(today);
    start.setDate(start.getDate() - Math.floor(days / 2));
    const end = new Date(today);
    end.setDate(end.getDate() + Math.ceil(days / 2));
    dom.rangeStart.value = start.toISOString().slice(0, 10);
    dom.rangeEnd.value = end.toISOString().slice(0, 10);
    renderGantt();
  });
}

function hasSelectOption(selectNode, value) {
  return Array.from(selectNode.options).some((option) => option.value === value);
}

function loadProjectActivities({ resetView = false } = {}) {
  const previousView = {
    phase: dom.phaseFilter.value,
    status: dom.statusFilter.value,
    rangeStart: dom.rangeStart.value,
    rangeEnd: dom.rangeEnd.value,
  };

  activities = enrichActivities(getActivities());
  dependencyHealth = getDependencyHealth(activities);
  bounds = getTimelineBounds(activities);
  populateFilters();

  if (resetView) {
    dom.phaseFilter.value = "";
    dom.statusFilter.value = "";
    dom.rangeStart.value = bounds.min.toISOString().slice(0, 10);
    dom.rangeEnd.value = bounds.max.toISOString().slice(0, 10);
    renderGantt();
    return;
  }

  dom.phaseFilter.value = hasSelectOption(dom.phaseFilter, previousView.phase) ? previousView.phase : "";
  dom.statusFilter.value = hasSelectOption(dom.statusFilter, previousView.status) ? previousView.status : "";

  const restoredStart = parseDate(previousView.rangeStart);
  const restoredEnd = parseDate(previousView.rangeEnd);
  dom.rangeStart.value = restoredStart ? previousView.rangeStart : bounds.min.toISOString().slice(0, 10);
  dom.rangeEnd.value = restoredEnd ? previousView.rangeEnd : bounds.max.toISOString().slice(0, 10);
  renderGantt();
}

function initialize() {
  setActiveNavigation();
  const currentUser = initializeAccessShell();
  if (!currentUser) return;
  wireEvents();
  initializeProjectToolbar({ onProjectChange: () => loadProjectActivities({ resetView: true }) });
  const unsubscribe = subscribeToStateChanges(() => loadProjectActivities({ resetView: false }));
  window.addEventListener(
    "pagehide",
    () => {
      unsubscribe();
    },
    { once: true },
  );
  loadProjectActivities({ resetView: true });
}

initialize();
