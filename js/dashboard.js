import { computePortfolioMetrics, getDelayAndRiskRows, getMaterialHealth, getPhaseProgress, groupBy } from "./analytics.js";
import { escapeHtml, formatCurrency, formatHours, renderEmptyState, setActiveNavigation, statusClass } from "./common.js";
import { getActivities, getProjectActions, subscribeToStateChanges } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { getRoleLabel } from "./auth.js";

let phaseChart;
let riskChart;
let currentUser;
let snapshotDate = new Date();

/** KPI variant: primary (dark), good (green), critical (red), warning (orange), active (blue) */
function buildKpiCards(metrics, role) {
  if (role === "management") {
    return [
      { title: "Portfolio Activities", value: metrics.totalActivities, note: "Current monitored scope", link: "activities.html", variant: "primary" },
      { title: "Critical Delay Load", value: metrics.delayed, note: "Activities behind plan", link: "activities.html", filter: "Delayed", variant: metrics.delayed > 0 ? "critical" : "primary" },
      { title: "High-Risk Exposure", value: metrics.highRisk, note: "Risk score >= 55", link: "intelligence.html", variant: metrics.highRisk > 0 ? "critical" : "primary" },
      { title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Execution progress", variant: metrics.avgCompletion >= 80 ? "good" : metrics.avgCompletion >= 50 ? "active" : "warning" },
      { title: "Estimated Cost", value: formatCurrency(metrics.estimatedCost), note: "Portfolio baseline", variant: "primary" },
      { title: "Cost Variance", value: formatCurrency(metrics.costVariance), note: "Current variance", variant: metrics.costVariance > 0 ? "warning" : "good" },
    ];
  }
  if (role === "technician") {
    return [
      { title: "Assigned Activities", value: metrics.totalActivities, note: "Visible project scope", variant: "primary" },
      { title: "In Progress", value: metrics.inProgress, note: "Activities currently running", link: "activities.html", filter: "In Progress", variant: "active" },
      { title: "Delayed", value: metrics.delayed, note: "Immediate escalation queue", link: "activities.html", filter: "Delayed", variant: metrics.delayed > 0 ? "critical" : "primary" },
      { title: "Blocked", value: metrics.blockedActivities.length, note: "Waiting on dependencies", variant: metrics.blockedActivities.length > 0 ? "warning" : "primary" },
      { title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Execution update status", variant: metrics.avgCompletion >= 80 ? "good" : "primary" },
    ];
  }
  return [
    { title: "Total Activities", value: metrics.totalActivities, note: "Current planning scope", link: "activities.html", variant: "primary" },
    { title: "Delayed Activities", value: metrics.delayed, note: "Past planned finish without closure", link: "activities.html", filter: "Delayed", variant: metrics.delayed > 0 ? "critical" : "primary" },
    { title: "High/Critical Risk", value: metrics.highRisk, note: "Risk score >= 55", link: "intelligence.html", variant: metrics.highRisk > 0 ? "critical" : "primary" },
    { title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Across all activities", variant: metrics.avgCompletion >= 80 ? "good" : "primary" },
    { title: "Completed", value: metrics.completed, note: "Execution closed activities", link: "activities.html", filter: "Completed", variant: "good" },
    { title: "Dependency Blocked", value: metrics.blockedActivities.length, note: "Waiting on predecessor release", variant: metrics.blockedActivities.length > 0 ? "warning" : "primary" },
    { title: "Estimated Cost", value: formatCurrency(metrics.estimatedCost), note: "Portfolio estimate", variant: "primary" },
    {
      title: "Cost Variance",
      value: formatCurrency(metrics.costVariance),
      note: metrics.costVariance > 0 ? "Over baseline" : "Within baseline",
      variant: metrics.costVariance > 0 ? "warning" : "good",
    },
  ];
}

function renderKpis(metrics, role) {
  const cards = buildKpiCards(metrics, role);
  const host = document.querySelector("#kpi-grid");
  host.innerHTML = cards
    .map(
      (card) => {
        const variant = card.variant || "primary";
        const variantClass = `kpi-variant-${variant}`;
        const href = card.link
          ? `${card.link}${card.filter ? `?status=${encodeURIComponent(card.filter)}` : ""}`
          : null;
        const wrap = href
          ? (content) => `<a href="${escapeHtml(href)}" class="kpi-card kpi-card-link ${variantClass}" data-drill-link="${escapeHtml(href)}" data-kpi-title="${escapeHtml(card.title)}">${content}</a>`
          : (content) => `<article class="kpi-card ${variantClass}">${content}</article>`;
        return wrap(`
        <div class="kpi-title" title="${escapeHtml(card.note)}">${escapeHtml(card.title)}</div>
        <div class="kpi-value" title="${escapeHtml(card.note)}">${escapeHtml(String(card.value))}</div>
        <div class="kpi-note">${escapeHtml(card.note)}${href ? " — Click to drill down" : ""}</div>
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
      <tr>
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

function renderPhaseChart(phaseRows) {
  const context = document.querySelector("#phase-chart");
  if (phaseChart) phaseChart.destroy();
  if (!phaseRows.length) return;

  phaseChart = new Chart(context, {
    type: "bar",
    data: {
      labels: phaseRows.map((row) => row.phase),
      datasets: [
        {
          label: "Average Completion %",
          data: phaseRows.map((row) => row.avgCompletion),
          borderWidth: 1,
          backgroundColor: "rgba(0, 86, 145, 0.75)",
        },
        {
          label: "Delayed Activities",
          data: phaseRows.map((row) => row.delayedActivities),
          borderWidth: 1,
          backgroundColor: "rgba(224, 4, 32, 0.78)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: "#31343A" },
          grid: { color: "rgba(182, 187, 190, 0.5)" },
        },
        x: {
          ticks: { color: "#31343A" },
          grid: { color: "rgba(182, 187, 190, 0.35)" },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#31343A" },
        },
      },
    },
  });
}

function renderRiskChart(rows) {
  const context = document.querySelector("#risk-chart");
  if (riskChart) riskChart.destroy();
  if (!rows.length) return;

  const grouped = groupBy(rows, (row) => row.riskLevel || "Unspecified");
  riskChart = new Chart(context, {
    type: "doughnut",
    data: {
      labels: Object.keys(grouped),
      datasets: [
        {
          data: Object.values(grouped),
          backgroundColor: [
            "rgba(13, 155, 92, 0.85)",
            "rgba(0, 86, 145, 0.8)",
            "rgba(224, 4, 32, 0.85)",
            "rgba(245, 158, 11, 0.8)",
            "rgba(157, 165, 168, 0.7)",
          ],
          borderColor: "#fff",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#31343A" },
        },
      },
    },
  });
}

function render() {
  if (!currentUser) return;
  const role = currentUser.role;
  const activities = getActivities();
  const metrics = computePortfolioMetrics(activities, snapshotDate);
  renderKpis(metrics, role);

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
    renderPhaseChart(getPhaseProgress(activities));
    renderRiskChart(metrics.enriched);
  }

  const riskRows = getDelayAndRiskRows(activities, snapshotDate);
  const roleRows =
    role === "technician"
      ? riskRows.filter((row) => String(row.activityStatus).toLowerCase() !== "completed")
      : riskRows;
  renderRiskTable(roleRows);
  renderAlertCenter(metrics, activities);

  const datePicker = document.querySelector("#dashboard-date-picker");
  if (datePicker) {
    datePicker.value = snapshotDate.toISOString().slice(0, 10);
  }
}

function wireDashboardEvents() {
  const datePicker = document.querySelector("#dashboard-date-picker");
  const refreshBtn = document.querySelector("#dashboard-refresh-btn");
  datePicker?.addEventListener("change", (e) => {
    snapshotDate = new Date(e.target.value || Date.now());
    render();
  });
  refreshBtn?.addEventListener("click", () => {
    snapshotDate = new Date();
    if (datePicker) datePicker.value = snapshotDate.toISOString().slice(0, 10);
    render();
  });
}

function initialize() {
  initShell();
  setActiveNavigation();
  currentUser = initializeAccessShell();
  if (!currentUser) return;
  initializeProjectToolbar({ onProjectChange: render });
  wireDashboardEvents();
  const unsubscribe = subscribeToStateChanges(render);
  window.addEventListener(
    "pagehide",
    () => {
      unsubscribe();
    },
    { once: true },
  );
  render();
}

initialize();
