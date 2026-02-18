import { computePortfolioMetrics, getDelayAndRiskRows, getPhaseProgress, groupBy } from "./analytics.js";
import { formatCurrency, formatHours, renderEmptyState, setActiveNavigation, statusClass } from "./common.js";
import { getActivities } from "./storage.js";

let phaseChart;
let riskChart;

function renderKpis(metrics) {
  const cards = [
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
          backgroundColor: "rgba(79, 179, 255, 0.72)",
        },
        {
          label: "Delayed Activities",
          data: phaseRows.map((row) => row.delayedActivities),
          borderWidth: 1,
          backgroundColor: "rgba(255, 79, 123, 0.65)",
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
            color: "#b9d1f3",
          },
          grid: { color: "rgba(47, 79, 132, 0.35)" },
        },
        x: {
          ticks: { color: "#b9d1f3" },
          grid: { color: "rgba(47, 79, 132, 0.2)" },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: "#dceaff",
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
            "rgba(44, 211, 139, 0.75)",
            "rgba(255, 206, 82, 0.72)",
            "rgba(255, 139, 61, 0.74)",
            "rgba(255, 79, 123, 0.78)",
            "rgba(142, 169, 220, 0.62)",
          ],
          borderColor: "#111f39",
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
            color: "#dceaff",
          },
        },
      },
    },
  });
}

function render() {
  const activities = getActivities();
  const metrics = computePortfolioMetrics(activities);
  renderKpis(metrics);
  renderCriticalPath(metrics);
  renderBlocked(metrics);

  const riskRows = getDelayAndRiskRows(activities);
  renderRiskTable(riskRows);
  renderPhaseChart(getPhaseProgress(activities));
  renderRiskChart(metrics.enriched);

  const dateLabel = document.querySelector("#dashboard-date");
  dateLabel.textContent = `Snapshot: ${new Date().toISOString().slice(0, 10)}`;
}

setActiveNavigation();
render();
