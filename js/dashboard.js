import { computePortfolioMetrics, getDelayAndRiskRows, getMaterialHealth, getPhaseProgress, groupBy } from "./analytics.js";
import { formatCurrency, formatHours, renderEmptyState, setActiveNavigation, statusClass } from "./common.js";
import { getActivities, subscribeToStateChanges } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { getRoleLabel } from "./auth.js";

let phaseChart;
let riskChart;
let currentUser;

function buildKpiCards(metrics, role) {
  if (role === "management") {
    return [
      { title: "Portfolio Activities", value: metrics.totalActivities, note: "Current monitored scope" },
      { title: "Critical Delay Load", value: metrics.delayed, note: "Activities behind plan" },
      { title: "High-Risk Exposure", value: metrics.highRisk, note: "Risk score >= 55" },
      { title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Execution progress" },
      { title: "Estimated Cost", value: formatCurrency(metrics.estimatedCost), note: "Portfolio baseline" },
      { title: "Cost Variance", value: formatCurrency(metrics.costVariance), note: "Current variance" },
    ];
  }
  if (role === "technician") {
    return [
      { title: "Assigned Activities", value: metrics.totalActivities, note: "Visible project scope" },
      { title: "In Progress", value: metrics.inProgress, note: "Activities currently running" },
      { title: "Delayed", value: metrics.delayed, note: "Immediate escalation queue" },
      { title: "Blocked", value: metrics.blockedActivities.length, note: "Waiting on dependencies" },
      { title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Execution update status" },
    ];
  }
  return [
    { title: "Total Activities", value: metrics.totalActivities, note: "Current planning scope" },
    { title: "Delayed Activities", value: metrics.delayed, note: "Past planned finish without closure" },
    { title: "High/Critical Risk", value: metrics.highRisk, note: "Risk score >= 55" },
    { title: "Average Completion", value: `${metrics.avgCompletion}%`, note: "Across all activities" },
    { title: "Completed", value: metrics.completed, note: "Execution closed activities" },
    { title: "Dependency Blocked", value: metrics.blockedActivities.length, note: "Waiting on predecessor release" },
    { title: "Estimated Cost", value: formatCurrency(metrics.estimatedCost), note: "Portfolio estimate" },
    {
      title: "Cost Variance",
      value: formatCurrency(metrics.costVariance),
      note: metrics.costVariance > 0 ? "Over baseline" : "Within baseline",
    },
  ];
}

function renderKpis(metrics, role) {
  const cards = buildKpiCards(metrics, role);
  const host = document.querySelector("#kpi-grid");
  host.innerHTML = cards
    .map(
      (card) => `
      <article class="kpi-card">
        <div class="kpi-title">${card.title}</div>
        <div class="kpi-value">${card.value}</div>
        <div class="kpi-note">${card.note}</div>
      </article>
    `,
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
  const activities = getActivities();
  const metrics = computePortfolioMetrics(activities);
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

  const riskRows = getDelayAndRiskRows(activities);
  const roleRows =
    role === "technician"
      ? riskRows.filter((row) => String(row.activityStatus).toLowerCase() !== "completed")
      : riskRows;
  renderRiskTable(roleRows);
  renderAlertCenter(metrics, activities);

  const dateLabel = document.querySelector("#dashboard-date");
  if (dateLabel) {
    dateLabel.textContent = `Snapshot: ${new Date().toISOString().slice(0, 10)} | Role: ${getRoleLabel(currentUser)}`;
  }
}

function initialize() {
  setActiveNavigation();
  currentUser = initializeAccessShell();
  if (!currentUser) return;
  initializeProjectToolbar({ onProjectChange: render });
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
