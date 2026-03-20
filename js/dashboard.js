import { computePortfolioMetrics, getDelayAndRiskRows, getMaterialHealth, getPhaseProgress, groupBy } from "./analytics.js";
import { escapeHtml, formatCurrency, formatHours, notify, renderEmptyState, setActiveNavigation, statusClass } from "./common.js";
import { createSampleDataset } from "./schema.js";
import { getActivities, getDashboardKpiConfig, getProjectActions, saveActivities, saveDashboardKpiConfig } from "./storage.js";
import { getRoleLabel } from "./auth.js";
import { initPage } from "./page-init.js";
import { hasCompletedOnboarding, startOnboarding } from "./onboarding.js";

let phaseChart;
let riskChart;
let currentUser;
let snapshotDate = new Date();
let timeRangeDays = 30;
let compareRange = "";

function filterActivitiesByTimeRange(activities, refDate, days) {
  if (!days || days >= 365) return activities;
  const start = new Date(refDate);
  start.setDate(start.getDate() - Number(days));
  start.setHours(0, 0, 0, 0);
  const end = new Date(refDate);
  end.setHours(23, 59, 59, 999);
  return activities.filter((a) => {
    const ps = a.plannedStartDate ? new Date(a.plannedStartDate) : null;
    const pe = a.plannedEndDate ? new Date(a.plannedEndDate) : null;
    const as = a.actualStartDate ? new Date(a.actualStartDate) : null;
    const ae = a.actualEndDate ? new Date(a.actualEndDate) : null;
    const date = ae || as || pe || ps;
    if (!date || Number.isNaN(date.getTime())) return true;
    return date >= start && date <= end;
  });
}

function buildKpiCards(metrics, role, compareMetrics = null) {
  let cards;
  if (role === "management") {
    cards = [
      { id: "total", title: "Portfolio Activities", value: metrics.totalActivities, note: "Current monitored scope", link: "activities.html" },
      { id: "delayed", title: "Critical Delay Load", value: metrics.delayed, note: "Activities behind plan", link: "activities.html", filter: "Delayed" },
      { id: "highRisk", title: "High-Risk Exposure", value: metrics.highRisk, note: "Risk score >= 55", link: "intelligence.html" },
      { id: "completion", title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Execution progress" },
      { id: "estimatedCost", title: "Estimated Cost", value: formatCurrency(metrics.estimatedCost), note: "Portfolio baseline" },
      { id: "costVariance", title: "Cost Variance", value: formatCurrency(metrics.costVariance), note: "Current variance" },
    ];
  } else if (role === "technician") {
    cards = [
      { id: "total", title: "Assigned Activities", value: metrics.totalActivities, note: "Visible project scope" },
      { id: "inProgress", title: "In Progress", value: metrics.inProgress, note: "Activities currently running" },
      { id: "delayed", title: "Delayed", value: metrics.delayed, note: "Immediate escalation queue" },
      { id: "blocked", title: "Blocked", value: metrics.blockedActivities.length, note: "Waiting on dependencies" },
      { id: "completion", title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Execution update status" },
    ];
  } else {
    cards = [
      { id: "total", title: "Total Activities", value: metrics.totalActivities, note: "Current planning scope", link: "activities.html" },
      { id: "delayed", title: "Delayed Activities", value: metrics.delayed, note: "Past planned finish without closure", link: "activities.html", filter: "Delayed" },
      { id: "highRisk", title: "High/Critical Risk", value: metrics.highRisk, note: "Risk score >= 55", link: "intelligence.html" },
      { id: "completion", title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Across all activities" },
      { id: "completed", title: "Completed", value: metrics.completed, note: "Execution closed activities" },
      { id: "blocked", title: "Dependency Blocked", value: metrics.blockedActivities.length, note: "Waiting on predecessor release" },
      { id: "estimatedCost", title: "Estimated Cost", value: formatCurrency(metrics.estimatedCost), note: "Portfolio estimate" },
      { id: "costVariance", title: "Cost Variance", value: formatCurrency(metrics.costVariance), note: metrics.costVariance > 0 ? "Over baseline" : "Within baseline" },
    ];
  }

  const config = getDashboardKpiConfig();
  let filtered = cards.filter((c) => !config.hidden.includes(c.id));
  if (config.order.length) {
    const orderMap = new Map(config.order.map((id, i) => [id, i]));
    filtered.sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));
  }
  if (compareMetrics) {
    const compareMap = {
      total: compareMetrics.totalActivities,
      delayed: compareMetrics.delayed,
      highRisk: compareMetrics.highRisk,
      completion: `${compareMetrics.avgCompletion}%`,
      completed: compareMetrics.completed,
      blocked: compareMetrics.blockedActivities?.length ?? 0,
      inProgress: compareMetrics.inProgress,
      estimatedCost: formatCurrency(compareMetrics.estimatedCost),
      costVariance: formatCurrency(compareMetrics.costVariance),
    };
    filtered = filtered.map((c) => ({
      ...c,
      compareValue: compareMap[c.id],
    }));
  }
  return filtered;
}

function renderKpis(metrics, role, compareMetrics) {
  const cards = buildKpiCards(metrics, role, compareMetrics);
  const host = document.querySelector("#kpi-grid");
  host.innerHTML = cards
    .map(
      (card) => {
        const href = card.link
          ? `${card.link}${card.filter ? `?status=${encodeURIComponent(card.filter)}` : ""}`
          : null;
        const wrap = href
          ? (content) => `<a href="${escapeHtml(href)}" class="kpi-card kpi-card-link">${content}</a>`
          : (content) => `<article class="kpi-card">${content}</article>`;
        const compareHtml = card.compareValue != null ? `<div class="kpi-compare small">Prev: ${escapeHtml(String(card.compareValue))}</div>` : "";
        return wrap(`
        <div class="kpi-title" title="${escapeHtml(card.note)}">${escapeHtml(card.title)}</div>
        <div class="kpi-value" title="${escapeHtml(card.note)}">${escapeHtml(String(card.value))}</div>
        ${compareHtml}
        <div class="kpi-note">${escapeHtml(card.note)}</div>
      `);
      },
    )
    .join("");
}

function renderCriticalPath(metrics) {
  const host = document.querySelector("#critical-path-list");
  if (!metrics.criticalPath.path.length) {
    renderEmptyState(host, "No dependency path found. Add activities with dependencies to compute the critical chain.");
    return;
  }

  const byId = new Map(metrics.enriched.map((activity) => [activity.activityId, activity]));
  host.innerHTML = metrics.criticalPath.path
    .map((activityId, index) => {
      const activity = byId.get(activityId);
      return `
      <li>
        <div><strong>${index + 1}. ${activityId}</strong> - ${activity?.activityName ?? "Unknown Activity"}</div>
        <div class="small">Duration: ${formatHours(activity?.plannedDurationHours)} | Priority: ${activity?.priority || "-"}</div>
      </li>
    `;
    })
    .join("");
  host.insertAdjacentHTML(
    "beforeend",
    `<li><strong>Total Critical Path Duration:</strong> ${formatHours(metrics.criticalPath.durationHours)}</li>`,
  );
}

function renderBlocked(metrics) {
  const host = document.querySelector("#blocked-list");
  if (!metrics.blockedActivities.length) {
    renderEmptyState(host, "No activities are currently blocked by dependencies.");
    return;
  }
  host.innerHTML = metrics.blockedActivities
    .slice(0, 10)
    .map(
      (activity) => `
      <li>
        <div><strong>${activity.activityId}</strong> - ${activity.activityName || "-"}</div>
        <div class="small">Blocked by: ${activity.blockingDependencies.join(", ")}</div>
      </li>
    `,
    )
    .join("");
}

function renderRiskTable(rows) {
  const body = document.querySelector("#risk-table-body");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty-state">No delayed or high-risk activities detected.</div></td></tr>`;
    return;
  }

  body.innerHTML = rows
    .slice(0, 14)
    .map(
      (row) => `
      <tr class="row-clickable" data-activity-id="${escapeHtml(row.activityId)}" title="Click to open in Activity Master">
        <td><strong>${row.activityId}</strong><br /><span class="small">${row.activityName || "-"}</span></td>
        <td>${row.phase || "-"}</td>
        <td><span class="${statusClass(row.activityStatus)}">${row.activityStatus}</span></td>
        <td>
          <div class="progress"><span style="width:${row.completionPercentage}%"></span></div>
          <div class="small">${row.completionPercentage}%</div>
        </td>
        <td>${Math.round(row.delayHours)}</td>
        <td><span class="${statusClass(row.riskLevel)}">${row.riskLevel} (${row.riskScore})</span></td>
        <td>${row.resourceDepartment || "-"}</td>
        <td>${row.delayReason || "-"}</td>
      </tr>
    `,
    )
    .join("");

  body.querySelectorAll("tr.row-clickable").forEach((tr) => {
    tr.style.cursor = "pointer";
    tr.addEventListener("click", (e) => {
      if (e.target.tagName === "A" || e.target.closest("a")) return;
      const id = tr.dataset.activityId;
      if (id) window.location.href = `activities.html?search=${encodeURIComponent(id)}`;
    });
  });
}

function renderAlertCenter(metrics, activities) {
  const host = document.querySelector("#dashboard-alert-list");
  if (!host) return;
  const materialHealth = getMaterialHealth(activities);
  const alerts = [];

  if (metrics.delayed > 0) {
    alerts.push(`Delayed activities detected: ${metrics.delayed}`);
  }
  if (metrics.highRisk > 0) {
    alerts.push(`High-risk activities requiring escalation: ${metrics.highRisk}`);
  }
  if (materialHealth.lateMaterials.length > 0) {
    alerts.push(`Late material lines impacting execution: ${materialHealth.lateMaterials.length}`);
  }
  if (metrics.blockedActivities.length > 0) {
    alerts.push(`Dependency blockers active: ${metrics.blockedActivities.length}`);
  }

  const actions = getProjectActions();
  const openActions = actions.filter((action) => String(action.status || "").toLowerCase() !== "closed");
  const overdueActions = openActions.filter((action) => {
    if (!action.dueDate) return false;
    const dueDate = new Date(action.dueDate);
    if (Number.isNaN(dueDate.getTime())) return false;
    dueDate.setHours(23, 59, 59, 999);
    return dueDate.getTime() < Date.now();
  });
  if (openActions.length > 0) {
    alerts.push(`Open mitigation actions: ${openActions.length}`);
  }
  if (overdueActions.length > 0) {
    alerts.push(`Overdue mitigation actions: ${overdueActions.length}`);
  }

  if (!alerts.length) {
    renderEmptyState(host, "No active alerts. Portfolio is within control thresholds.");
    return;
  }

  host.innerHTML = alerts
    .map(
      (alert) => `
      <li>
        <strong>Action Required</strong>
        <div class="small">${alert}</div>
      </li>
    `,
    )
    .join("");
}

function exportChartAsPng(canvasId, filename) {
  const canvas = document.querySelector(`#${canvasId}`);
  if (!canvas) return;
  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.png`;
  link.click();
  notify("Chart exported as PNG.", "success");
}

let chartJsLoaded = null;
async function loadChartJs() {
  if (chartJsLoaded) return chartJsLoaded;
  chartJsLoaded = new Promise((resolve) => {
    if (typeof window.Chart !== "undefined") {
      resolve(window.Chart);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
    script.onload = () => resolve(window.Chart);
    document.head.appendChild(script);
  });
  return chartJsLoaded;
}

async function renderPhaseChart(phaseRows) {
  const context = document.querySelector("#phase-chart");
  if (phaseChart) phaseChart.destroy();
  if (!phaseRows.length) return;

  const Chart = await loadChartJs();
  phaseChart = new Chart(context, {
    type: "bar",
    data: {
      labels: phaseRows.map((row) => row.phase),
      datasets: [
        {
          label: "Average Completion %",
          data: phaseRows.map((row) => row.avgCompletion),
          borderWidth: 1,
          backgroundColor: "rgba(47, 143, 255, 0.72)",
        },
        {
          label: "Delayed Activities",
          data: phaseRows.map((row) => row.delayedActivities),
          borderWidth: 1,
          backgroundColor: "rgba(255, 77, 99, 0.76)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            color: "#35567f",
          },
          grid: { color: "rgba(155, 185, 225, 0.55)" },
        },
        x: {
          ticks: { color: "#35567f" },
          grid: { color: "rgba(155, 185, 225, 0.35)" },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: "#2f4f7a",
          },
        },
      },
    },
  });
}

async function renderRiskChart(rows) {
  const context = document.querySelector("#risk-chart");
  if (riskChart) riskChart.destroy();
  if (!rows.length) return;

  const Chart = await loadChartJs();
  const grouped = groupBy(rows, (row) => row.riskLevel || "Unspecified");
  riskChart = new Chart(context, {
    type: "doughnut",
    data: {
      labels: Object.keys(grouped),
      datasets: [
        {
          data: Object.values(grouped),
          backgroundColor: [
            "rgba(29, 184, 156, 0.78)",
            "rgba(47, 143, 255, 0.76)",
            "rgba(217, 21, 46, 0.78)",
            "rgba(97, 151, 224, 0.65)",
            "rgba(232, 241, 255, 0.62)",
          ],
          borderColor: "#e2ecfb",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#2f4f7a",
          },
        },
      },
    },
  });
}

function render() {
  if (!currentUser) return;
  const role = currentUser.role;
  const allActivities = getActivities();
  const activities = filterActivitiesByTimeRange(allActivities, snapshotDate, timeRangeDays);
  const metrics = computePortfolioMetrics(activities, snapshotDate);
  let compareMetrics = null;
  if (compareRange) {
    const compDays = compareRange === "prev" ? timeRangeDays : Number(compareRange) || 0;
    const compEnd = new Date(snapshotDate);
    compEnd.setDate(compEnd.getDate() - timeRangeDays);
    const compActivities = filterActivitiesByTimeRange(allActivities, compEnd, compDays);
    compareMetrics = computePortfolioMetrics(compActivities, compEnd);
  }
  renderKpis(metrics, role, compareMetrics);

  const phaseGrid = document.querySelector("#dashboard-phase-risk-grid");
  const dependencyGrid = document.querySelector("#dashboard-dependency-grid");
  if (role === "technician") {
    if (phaseGrid) phaseGrid.hidden = true;
    if (dependencyGrid) dependencyGrid.hidden = true;
    if (phaseChart) {
      phaseChart.destroy();
      phaseChart = null;
    }
    if (riskChart) {
      riskChart.destroy();
      riskChart = null;
    }
  } else {
    if (phaseGrid) phaseGrid.hidden = false;
    if (dependencyGrid) dependencyGrid.hidden = false;
    renderCriticalPath(metrics);
    renderBlocked(metrics);
    renderPhaseChart(getPhaseProgress(activities)).catch(() => {});
    renderRiskChart(metrics.enriched).catch(() => {});
  }

  const riskRows = getDelayAndRiskRows(activities, snapshotDate);
  const roleRows =
    role === "technician"
      ? riskRows.filter((row) => String(row.activityStatus).toLowerCase() !== "completed")
      : riskRows;
  renderRiskTable(roleRows);
  renderAlertCenter(metrics, activities);

  const emptyBanner = document.getElementById("dashboard-empty-banner");
  if (emptyBanner) emptyBanner.hidden = !!allActivities.length;

  const datePicker = document.querySelector("#dashboard-date-picker");
  if (datePicker) {
    datePicker.value = snapshotDate.toISOString().slice(0, 10);
  }
}

function openCustomizeKpis(metrics, role) {
  const cards = buildKpiCards(metrics, role);
  const config = getDashboardKpiConfig();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.innerHTML = `
    <div class="modal-dialog modal-dialog-kpi-customize">
      <h2 class="modal-title">Customize KPIs</h2>
      <p class="kpi-customize-lead">Check to show, uncheck to hide.</p>
      <ul id="kpi-customize-list" class="kpi-customize-list">
        ${cards.map((c) => `
          <li class="kpi-customize-item" data-kpi-id="${escapeHtml(c.id)}">
            <label class="kpi-customize-label">
              <input type="checkbox" ${config.hidden.includes(c.id) ? "" : "checked"} data-kpi-visible />
              <span class="kpi-customize-title">${escapeHtml(c.title)}</span>
            </label>
          </li>
        `).join("")}
      </ul>
      <div class="modal-actions">
        <button type="button" class="modal-secondary ghost kpi-customize-cancel">Cancel</button>
        <button type="button" class="modal-primary">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
  };

  overlay.querySelector(".modal-primary").addEventListener("click", () => {
    const list = overlay.querySelector("#kpi-customize-list");
    const order = [...list.querySelectorAll("li")].map((li) => li.dataset.kpiId);
    const hidden = [...list.querySelectorAll("li")].filter((li) => !li.querySelector("[data-kpi-visible]")?.checked).map((li) => li.dataset.kpiId);
    saveDashboardKpiConfig({ order, hidden });
    close();
    notify("KPI layout saved.", "success");
    render();
  });
  overlay.querySelector(".modal-secondary").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function wireDashboardEvents() {
  const datePicker = document.querySelector("#dashboard-date-picker");
  const timeRangeSelect = document.querySelector("#dashboard-time-range");
  const refreshBtn = document.querySelector("#dashboard-refresh-btn");
  const compareSelect = document.querySelector("#dashboard-compare-range");
  const customizeBtn = document.querySelector("#dashboard-customize-kpis");
  datePicker?.addEventListener("change", (e) => {
    snapshotDate = new Date(e.target.value || Date.now());
    render();
  });
  timeRangeSelect?.addEventListener("change", (e) => {
    timeRangeDays = Number(e.target.value) || 30;
    render();
  });
  compareSelect?.addEventListener("change", (e) => {
    compareRange = e.target?.value || "";
    render();
  });
  customizeBtn?.addEventListener("click", () => {
    const allActivities = getActivities();
    const activities = filterActivitiesByTimeRange(allActivities, snapshotDate, timeRangeDays);
    const metrics = computePortfolioMetrics(activities, snapshotDate);
    openCustomizeKpis(metrics, currentUser?.role);
  });
  refreshBtn?.addEventListener("click", () => {
    snapshotDate = new Date();
    if (datePicker) datePicker.value = snapshotDate.toISOString().slice(0, 10);
    render();
  });
}

function initialize() {
  setActiveNavigation();
  initPage({
    requireAuth: true,
    onReady(user) {
      currentUser = user;
      if (!currentUser) return;
      wireDashboardEvents();
      document.querySelector("#dashboard-tour-btn")?.addEventListener("click", startOnboarding);
      document
        .querySelector("#phase-chart-export-btn")
        ?.addEventListener("click", () => exportChartAsPng("phase-chart", "phase-completion-chart"));
      document
        .querySelector("#risk-chart-export-btn")
        ?.addEventListener("click", () => exportChartAsPng("risk-chart", "risk-distribution-chart"));
      render();
    },
    onProjectChange() {
      render();
    },
    onStateChange() {
      render();
    },
  }).catch((e) => console.error("[dashboard] init error:", e));
}

initialize();
