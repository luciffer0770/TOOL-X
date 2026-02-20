import { computePortfolioMetrics, getAnomalyRows, getTimelineBounds } from "./analytics.js";
import { escapeHtml, formatCurrency, formatDate, formatHours, notify, setActiveNavigation, statusClass, toCsv, triggerDownload } from "./common.js";
import {
  addProjectAction,
  addProjectBaseline,
  deleteProjectAction,
  getActivities,
  getProjectActions,
  getProjectBaselines,
  subscribeToStateChanges,
  updateProjectAction,
} from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { canManageProjects } from "./auth.js";

const dom = {
  anomalyKpiGrid: document.querySelector("#anomaly-kpi-grid"),
  anomalySeverityFilter: document.querySelector("#anomaly-severity-filter"),
  anomalySearchInput: document.querySelector("#anomaly-search-input"),
  anomalySummary: document.querySelector("#anomaly-summary"),
  anomalyTableBody: document.querySelector("#anomaly-table-body"),
  baselineNameInput: document.querySelector("#baseline-name-input"),
  baselineCompareSelect: document.querySelector("#baseline-compare-select"),
  baselineLockButton: document.querySelector("#baseline-lock-btn"),
  baselineSummary: document.querySelector("#baseline-summary"),
  baselineVarianceGrid: document.querySelector("#baseline-variance-grid"),
  baselineHistoryBody: document.querySelector("#baseline-history-body"),
  baselineCompareBody: document.querySelector("#baseline-compare-body"),
  actionActivitySelect: document.querySelector("#action-activity-select"),
  actionTitleInput: document.querySelector("#action-title-input"),
  actionOwnerInput: document.querySelector("#action-owner-input"),
  actionDueDateInput: document.querySelector("#action-due-date-input"),
  actionPrioritySelect: document.querySelector("#action-priority-select"),
  actionStatusSelect: document.querySelector("#action-status-select"),
  actionNotesInput: document.querySelector("#action-notes-input"),
  actionCreateButton: document.querySelector("#action-create-btn"),
  actionFilterStatus: document.querySelector("#action-filter-status"),
  actionFilterPriority: document.querySelector("#action-filter-priority"),
  actionSummary: document.querySelector("#action-summary"),
  actionTableBody: document.querySelector("#action-table-body"),
  baselineExportVarianceBtn: document.querySelector("#baseline-export-variance-btn"),
};

let currentUser = null;
let activities = [];
let anomalyRows = [];
let baselineRows = [];
let actionRows = [];

function severityWeight(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "critical") return 4;
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  return 1;
}

function isActionOpen(action) {
  return String(action.status || "").toLowerCase() !== "closed";
}

function isActionOverdue(action) {
  if (!isActionOpen(action)) return false;
  if (!action.dueDate) return false;
  const due = new Date(action.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const now = new Date();
  due.setHours(23, 59, 59, 999);
  return due.getTime() < now.getTime();
}

function formatSignedNumber(value, suffix = "") {
  const number = Math.round((Number(value) || 0) * 10) / 10;
  const sign = number > 0 ? "+" : "";
  return `${sign}${number}${suffix}`;
}

function formatSignedCurrency(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${formatCurrency(number)}`;
  return formatCurrency(number);
}

function getProjectFinishDate(activitiesInput) {
  const relevant = activitiesInput.filter(
    (activity) => activity.plannedStartDate || activity.plannedEndDate || activity.actualStartDate || activity.actualEndDate,
  );
  if (!relevant.length) return null;
  const bounds = getTimelineBounds(relevant);
  if (!bounds.max) return null;
  return bounds.max;
}

function loadState() {
  activities = getActivities();
  anomalyRows = getAnomalyRows(activities);
  baselineRows = getProjectBaselines();
  actionRows = getProjectActions();
}

function renderAnomalySection() {
  const bySeverity = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
  };

  anomalyRows.forEach((row) => {
    const key = row.severity in bySeverity ? row.severity : "Low";
    bySeverity[key] += 1;
  });

  const cards = [
    { title: "Total Anomalies", value: anomalyRows.length, note: "All active data-quality and logic checks" },
    { title: "Critical", value: bySeverity.Critical, note: "Immediate correction required" },
    { title: "High", value: bySeverity.High, note: "Should be corrected in current cycle" },
    { title: "Medium/Low", value: bySeverity.Medium + bySeverity.Low, note: "Monitor and clean during review" },
  ];

  dom.anomalyKpiGrid.innerHTML = cards
    .map(
      (card) => `
      <article class="kpi-card">
        <div class="kpi-title">${escapeHtml(card.title)}</div>
        <div class="kpi-value">${card.value}</div>
        <div class="kpi-note">${escapeHtml(card.note)}</div>
      </article>
    `,
    )
    .join("");

  const severityFilter = dom.anomalySeverityFilter.value;
  const searchQuery = String(dom.anomalySearchInput.value || "")
    .trim()
    .toLowerCase();
  const filtered = anomalyRows.filter((row) => {
    if (severityFilter && row.severity !== severityFilter) return false;
    if (!searchQuery) return true;
    const target = `${row.activityId} ${row.activityName} ${row.issue} ${row.details}`.toLowerCase();
    return target.includes(searchQuery);
  });

  dom.anomalySummary.textContent = `${filtered.length} shown of ${anomalyRows.length} anomalies`;

  if (!filtered.length) {
    dom.anomalyTableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No anomalies for selected filters.</div></td></tr>`;
    return;
  }

  dom.anomalyTableBody.innerHTML = filtered
    .sort((left, right) => {
      const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDelta !== 0) return severityDelta;
      return String(left.activityId).localeCompare(String(right.activityId));
    })
    .map(
      (row) => `
      <tr data-anomaly-activity="${escapeHtml(row.activityId)}" data-anomaly-issue="${escapeHtml(row.issue)}" data-anomaly-recommendation="${escapeHtml(row.recommendation)}">
        <td><strong>${escapeHtml(row.activityId)}</strong><br /><span class="small">${escapeHtml(row.activityName || "-")}</span></td>
        <td>${escapeHtml(row.issue)}</td>
        <td><span class="${statusClass(row.severity)}">${escapeHtml(row.severity)}</span></td>
        <td>${escapeHtml(row.details)}</td>
        <td>${escapeHtml(row.recommendation)}</td>
        <td><button class="ghost" data-create-action-from-anomaly>Create Action</button></td>
      </tr>
    `,
    )
    .join("");
}

function renderBaselineHistoryTable() {
  if (!baselineRows.length) {
    dom.baselineHistoryBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No baseline snapshots yet.</div></td></tr>`;
    return;
  }

  dom.baselineHistoryBody.innerHTML = baselineRows
    .map(
      (baseline) => `
      <tr>
        <td><strong>${escapeHtml(baseline.name)}</strong><br /><span class="small">${escapeHtml(baseline.id)}</span></td>
        <td>${formatDate(baseline.createdAt)}</td>
        <td>${escapeHtml(baseline.createdBy || "-")}</td>
        <td>${baseline.activities.length}</td>
      </tr>
    `,
    )
    .join("");
}

function renderBaselineComparison(baseline) {
  if (!baseline) {
    dom.baselineVarianceGrid.innerHTML = `<div class="empty-state">Lock a baseline to activate variance tracking.</div>`;
    dom.baselineCompareBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">No baseline selected.</div></td></tr>`;
    dom.baselineSummary.textContent = "No baseline selected for comparison.";
    return;
  }

  const baselineMetrics = computePortfolioMetrics(baseline.activities);
  const currentMetrics = computePortfolioMetrics(activities);
  const baselineFinish = getProjectFinishDate(baseline.activities);
  const currentFinish = getProjectFinishDate(activities);
  const scheduleVarianceHours =
    baselineFinish && currentFinish ? Math.round(((currentFinish.getTime() - baselineFinish.getTime()) / (60 * 60 * 1000)) * 10) / 10 : 0;

  const varianceCards = [
    {
      title: "Activities Variance",
      value: formatSignedNumber(currentMetrics.totalActivities - baselineMetrics.totalActivities),
      note: `${baselineMetrics.totalActivities} baseline -> ${currentMetrics.totalActivities} current`,
    },
    {
      title: "Completion Variance",
      value: formatSignedNumber(currentMetrics.avgCompletion - baselineMetrics.avgCompletion, "%"),
      note: `${baselineMetrics.avgCompletion}% baseline -> ${currentMetrics.avgCompletion}% current`,
    },
    {
      title: "Delayed Variance",
      value: formatSignedNumber(currentMetrics.delayed - baselineMetrics.delayed),
      note: `${baselineMetrics.delayed} baseline -> ${currentMetrics.delayed} current`,
    },
    {
      title: "Actual Cost Variance",
      value: formatSignedCurrency(currentMetrics.actualCost - baselineMetrics.actualCost),
      note: `${formatCurrency(baselineMetrics.actualCost)} baseline -> ${formatCurrency(currentMetrics.actualCost)} current`,
    },
    {
      title: "Estimated Cost Variance",
      value: formatSignedCurrency(currentMetrics.estimatedCost - baselineMetrics.estimatedCost),
      note: `${formatCurrency(baselineMetrics.estimatedCost)} baseline -> ${formatCurrency(currentMetrics.estimatedCost)} current`,
    },
    {
      title: "Finish Date Variance",
      value: baselineFinish && currentFinish ? formatSignedNumber(scheduleVarianceHours, " h") : "-",
      note: baselineFinish && currentFinish ? `${formatDate(baselineFinish)} baseline -> ${formatDate(currentFinish)} current` : "Insufficient timeline dates",
    },
  ];

  dom.baselineVarianceGrid.innerHTML = varianceCards
    .map(
      (card) => `
      <article class="kpi-card">
        <div class="kpi-title">${escapeHtml(card.title)}</div>
        <div class="kpi-value">${escapeHtml(card.value)}</div>
        <div class="kpi-note">${escapeHtml(card.note)}</div>
      </article>
    `,
    )
    .join("");

  const rows = [
    {
      label: "Activities",
      baseline: baselineMetrics.totalActivities,
      current: currentMetrics.totalActivities,
      variance: formatSignedNumber(currentMetrics.totalActivities - baselineMetrics.totalActivities),
    },
    {
      label: "Average Completion",
      baseline: `${baselineMetrics.avgCompletion}%`,
      current: `${currentMetrics.avgCompletion}%`,
      variance: formatSignedNumber(currentMetrics.avgCompletion - baselineMetrics.avgCompletion, "%"),
    },
    {
      label: "Delayed Activities",
      baseline: baselineMetrics.delayed,
      current: currentMetrics.delayed,
      variance: formatSignedNumber(currentMetrics.delayed - baselineMetrics.delayed),
    },
    {
      label: "High-Risk Activities",
      baseline: baselineMetrics.highRisk,
      current: currentMetrics.highRisk,
      variance: formatSignedNumber(currentMetrics.highRisk - baselineMetrics.highRisk),
    },
    {
      label: "Estimated Cost",
      baseline: formatCurrency(baselineMetrics.estimatedCost),
      current: formatCurrency(currentMetrics.estimatedCost),
      variance: formatSignedCurrency(currentMetrics.estimatedCost - baselineMetrics.estimatedCost),
    },
    {
      label: "Actual Cost",
      baseline: formatCurrency(baselineMetrics.actualCost),
      current: formatCurrency(currentMetrics.actualCost),
      variance: formatSignedCurrency(currentMetrics.actualCost - baselineMetrics.actualCost),
    },
    {
      label: "Projected Finish",
      baseline: baselineFinish ? formatDate(baselineFinish) : "-",
      current: currentFinish ? formatDate(currentFinish) : "-",
      variance: baselineFinish && currentFinish ? formatSignedNumber(scheduleVarianceHours, " h") : "-",
    },
  ];

  dom.baselineCompareBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${escapeHtml(row.baseline)}</td>
        <td>${escapeHtml(row.current)}</td>
        <td>${escapeHtml(row.variance)}</td>
      </tr>
    `,
    )
    .join("");

  dom.baselineSummary.textContent = `Comparing against ${baseline.name} (${baseline.id}) captured on ${formatDate(baseline.createdAt)} by ${
    baseline.createdBy || "-"
  }.`;
}

function renderBaselineSection() {
  const previousSelectedBaseline = dom.baselineCompareSelect.value;
  if (!baselineRows.length) {
    dom.baselineCompareSelect.innerHTML = `<option value="">No baseline available</option>`;
  } else {
    dom.baselineCompareSelect.innerHTML = baselineRows
      .map(
        (baseline) =>
          `<option value="${escapeHtml(baseline.id)}">${escapeHtml(baseline.name)} (${formatDate(baseline.createdAt)})</option>`,
      )
      .join("");
  }

  if (previousSelectedBaseline && baselineRows.some((baseline) => baseline.id === previousSelectedBaseline)) {
    dom.baselineCompareSelect.value = previousSelectedBaseline;
  }

  renderBaselineHistoryTable();
  const selected = baselineRows.find((baseline) => baseline.id === dom.baselineCompareSelect.value) ?? baselineRows[0];
  if (selected && !dom.baselineCompareSelect.value) {
    dom.baselineCompareSelect.value = selected.id;
  }
  renderBaselineComparison(selected || null);
}

function populateActionActivitySelect() {
  const previous = dom.actionActivitySelect.value;
  const options = ['<option value="">Select activity</option>']
    .concat(
      activities
        .map((activity) => activity.activityId)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map((activityId) => {
          const row = activities.find((activity) => activity.activityId === activityId);
          return `<option value="${escapeHtml(activityId)}">${escapeHtml(activityId)} - ${escapeHtml(row?.activityName || "-")}</option>`;
        }),
    )
    .join("");
  dom.actionActivitySelect.innerHTML = options;
  if (previous && activities.some((activity) => activity.activityId === previous)) {
    dom.actionActivitySelect.value = previous;
  }
}

function renderActionTable() {
  const statusFilter = dom.actionFilterStatus.value;
  const priorityFilter = dom.actionFilterPriority.value;
  const filtered = actionRows
    .filter((action) => !statusFilter || action.status === statusFilter)
    .filter((action) => !priorityFilter || action.priority === priorityFilter)
    .sort((left, right) => {
      const overdueDelta = Number(isActionOverdue(right)) - Number(isActionOverdue(left));
      if (overdueDelta !== 0) return overdueDelta;
      return String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31"));
    });

  const openCount = actionRows.filter((action) => isActionOpen(action)).length;
  const overdueCount = actionRows.filter((action) => isActionOverdue(action)).length;
  dom.actionSummary.textContent = `${filtered.length} shown of ${actionRows.length} actions | Open: ${openCount} | Overdue: ${overdueCount}`;

  if (!filtered.length) {
    dom.actionTableBody.innerHTML = `<tr><td colspan="10"><div class="empty-state">No actions for selected filters.</div></td></tr>`;
    return;
  }

  dom.actionTableBody.innerHTML = filtered
    .map((action) => {
      const overdue = isActionOverdue(action);
      const dueLabel = action.dueDate ? formatDate(action.dueDate) : "-";
      return `
        <tr data-action-id="${escapeHtml(action.id)}">
          <td><strong>${escapeHtml(action.id)}</strong></td>
          <td>${escapeHtml(action.activityId || "-")}</td>
          <td>${escapeHtml(action.title || "-")}</td>
          <td>${escapeHtml(action.owner || "-")}</td>
          <td><span class="${statusClass(overdue ? "critical" : "medium")}">${escapeHtml(dueLabel)}${overdue ? " (Overdue)" : ""}</span></td>
          <td><span class="${statusClass(action.priority)}">${escapeHtml(action.priority)}</span></td>
          <td><span class="${statusClass(action.status)}">${escapeHtml(action.status)}</span></td>
          <td>${escapeHtml(action.notes || "-")}</td>
          <td>${formatDate(action.updatedAt)}</td>
          <td>
            <div class="cell-actions">
              <button class="ghost" data-set-status="Open">Open</button>
              <button class="ghost" data-set-status="In Review">Review</button>
              <button class="ghost" data-set-status="Closed">Close</button>
              <button class="danger" data-delete-action="true">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderActionSection() {
  populateActionActivitySelect();
  renderActionTable();
}

function renderAll() {
  loadState();
  renderAnomalySection();
  renderBaselineSection();
  renderActionSection();
}

function wireEvents() {
  dom.anomalySeverityFilter.addEventListener("change", renderAnomalySection);
  dom.anomalySearchInput.addEventListener("input", renderAnomalySection);

  dom.baselineLockButton.addEventListener("click", () => {
    if (!canManageProjects(currentUser)) {
      notify("Only planning and management roles can lock baselines.", "warning");
      return;
    }
    const baselineName = dom.baselineNameInput.value.trim();
    const created = addProjectBaseline({
      name: baselineName,
      createdBy: currentUser.displayName || currentUser.username,
    });
    notify(`Baseline locked: ${created.name}.`, "success");
    dom.baselineNameInput.value = "";
    renderAll();
    dom.baselineCompareSelect.value = created.id;
    renderBaselineSection();
  });

  dom.baselineCompareSelect.addEventListener("change", renderBaselineSection);

  dom.baselineExportVarianceBtn?.addEventListener("click", () => {
    const selectedId = dom.baselineCompareSelect?.value;
    const baseline = baselineRows.find((b) => b.id === selectedId);
    if (!baseline) {
      notify("Select a baseline to export variance report.", "warning");
      return;
    }
    const baselineMetrics = computePortfolioMetrics(baseline.activities);
    const currentMetrics = computePortfolioMetrics(activities);
    const baselineFinish = getProjectFinishDate(baseline.activities);
    const currentFinish = getProjectFinishDate(activities);
    const rows = [
      { Metric: "Activities", Baseline: baselineMetrics.totalActivities, Current: currentMetrics.totalActivities },
      { Metric: "Avg Completion %", Baseline: baselineMetrics.avgCompletion, Current: currentMetrics.avgCompletion },
      { Metric: "Delayed", Baseline: baselineMetrics.delayed, Current: currentMetrics.delayed },
      { Metric: "High Risk", Baseline: baselineMetrics.highRisk, Current: currentMetrics.highRisk },
      { Metric: "Finish Date", Baseline: baselineFinish ? formatDate(baselineFinish) : "-", Current: currentFinish ? formatDate(currentFinish) : "-" },
    ];
    triggerDownload(
      `variance_${baseline.name.replace(/[^a-z0-9]/gi, "_")}_${formatDate(new Date())}.csv`,
      toCsv(rows),
      "text/csv;charset=utf-8;",
    );
    notify("Variance report exported.", "success");
  });

  dom.actionCreateButton.addEventListener("click", () => {
    const activityId = dom.actionActivitySelect.value;
    const title = dom.actionTitleInput.value.trim();
    const owner = dom.actionOwnerInput.value.trim();
    const dueDate = dom.actionDueDateInput.value;

    if (!activityId) {
      notify("Select an activity before creating an action.", "warning");
      return;
    }
    if (!title) {
      notify("Action title is required.", "warning");
      return;
    }
    if (!owner) {
      notify("Action owner is required.", "warning");
      return;
    }

    const created = addProjectAction({
      activityId,
      title,
      owner,
      dueDate,
      priority: dom.actionPrioritySelect.value,
      status: dom.actionStatusSelect.value,
      notes: dom.actionNotesInput.value.trim(),
      createdBy: currentUser.displayName || currentUser.username,
    });

    notify(`Action created: ${created.id}.`, "success");
    dom.actionTitleInput.value = "";
    dom.actionNotesInput.value = "";
    renderAll();
  });

  dom.actionFilterStatus.addEventListener("change", renderActionTable);
  dom.actionFilterPriority.addEventListener("change", renderActionTable);

  dom.anomalyTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-create-action-from-anomaly]")) {
      const row = target.closest("tr");
      const activityId = row?.dataset.anomalyActivity || "";
      const issue = row?.dataset.anomalyIssue || "";
      const recommendation = row?.dataset.anomalyRecommendation || "";
      dom.actionActivitySelect.value = activityId;
      dom.actionTitleInput.value = issue;
      dom.actionNotesInput.value = recommendation;
      dom.actionOwnerInput.focus();
      notify("Action form pre-filled. Enter owner and due date.", "success");
    }
  });

  dom.actionTableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const row = target.closest("tr[data-action-id]");
    if (!row) return;
    const actionId = row.dataset.actionId;
    if (!actionId) return;

    if (target.matches("[data-delete-action]")) {
      deleteProjectAction(actionId);
      notify(`Action ${actionId} deleted.`, "warning");
      renderAll();
      return;
    }

    const status = target.getAttribute("data-set-status");
    if (!status) return;
    updateProjectAction(actionId, { status });
    notify(`Action ${actionId} moved to ${status}.`, "success");
    renderAll();
  });
}

function initialize() {
  setActiveNavigation();
  currentUser = initializeAccessShell();
  if (!currentUser) return;

  if (!canManageProjects(currentUser)) {
    dom.baselineLockButton.disabled = true;
    dom.baselineLockButton.title = "Only planning and management roles can lock baselines.";
  }

  wireEvents();
  initializeProjectToolbar({ onProjectChange: renderAll });
  const unsubscribe = subscribeToStateChanges(renderAll);
  window.addEventListener(
    "pagehide",
    () => {
      unsubscribe();
    },
    { once: true },
  );
  renderAll();
}

initialize();
