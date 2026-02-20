import { getMaterialHealth } from "./analytics.js";
import { formatDate, formatHours, renderEmptyState, setActiveNavigation, statusClass } from "./common.js";
import { getActivities, subscribeToStateChanges } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";

let ownershipChart;
let statusChart;
let health;

const dom = {
  kpiHost: document.querySelector("#material-kpis"),
  ownershipFilter: document.querySelector("#ownership-filter"),
  statusFilter: document.querySelector("#status-filter"),
  departmentFilter: document.querySelector("#department-filter"),
  tableBody: document.querySelector("#materials-table-body"),
  tableSummary: document.querySelector("#material-table-summary"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderKpis() {
  const total = health.enriched.length;
  const clientCount = health.enriched.filter((activity) =>
    String(activity.materialOwnership).toLowerCase().includes("client"),
  ).length;
  const internalCount = health.enriched.filter((activity) =>
    String(activity.materialOwnership).toLowerCase().includes("internal"),
  ).length;
  const supplierCount = health.enriched.filter((activity) =>
    String(activity.materialOwnership).toLowerCase().includes("supplier"),
  ).length;

  const avgLeadTime =
    total > 0
      ? Math.round(
          (health.enriched.reduce((sum, activity) => sum + (Number(activity.materialLeadTime) || 0), 0) / Math.max(1, total)) * 10,
        ) / 10
      : 0;

  const cards = [
    { title: "Tracked Material Activities", value: total, note: "Activities with material requirements" },
    { title: "Client Ownership", value: clientCount, note: "Client-owned material responsibility" },
    { title: "Internal Ownership", value: internalCount, note: "Internal team material responsibility" },
    { title: "Supplier Ownership", value: supplierCount, note: "External supplier material responsibility" },
    { title: "Pending Critical Materials", value: health.pendingCritical.length, note: "High or critical still pending" },
    { title: "Late Material Lines", value: health.lateMaterials.length, note: "Required date missed or late receipt" },
    { title: "Avg Lead Time", value: formatHours(avgLeadTime), note: "Mean lead time across activities" },
  ];

  dom.kpiHost.innerHTML = cards
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

function clearCharts() {
  if (ownershipChart) {
    ownershipChart.destroy();
    ownershipChart = null;
  }
  if (statusChart) {
    statusChart.destroy();
    statusChart = null;
  }
}

function renderCharts() {
  const ownershipContext = document.querySelector("#ownership-chart");
  const statusContext = document.querySelector("#material-status-chart");
  if (ownershipChart) ownershipChart.destroy();
  if (statusChart) statusChart.destroy();

  ownershipChart = new Chart(ownershipContext, {
    type: "pie",
    data: {
      labels: Object.keys(health.ownershipCounts),
      datasets: [
        {
          data: Object.values(health.ownershipCounts),
          backgroundColor: [
            "rgba(47, 143, 255, 0.75)",
            "rgba(29, 184, 156, 0.74)",
            "rgba(217, 21, 46, 0.74)",
            "rgba(225, 236, 252, 0.62)",
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

  statusChart = new Chart(statusContext, {
    type: "bar",
    data: {
      labels: Object.keys(health.statusCounts),
      datasets: [
        {
          label: "Count",
          data: Object.values(health.statusCounts),
          backgroundColor: "rgba(79, 179, 255, 0.76)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: "#35567f" },
          grid: { color: "rgba(155, 185, 225, 0.55)" },
        },
        x: {
          ticks: { color: "#35567f" },
          grid: { color: "rgba(155, 185, 225, 0.35)" },
        },
      },
      plugins: {
        legend: {
          labels: { color: "#2f4f7a" },
        },
      },
    },
  });
}

function populateFilters() {
  dom.ownershipFilter.innerHTML = ['<option value="">All</option>']
    .concat(
      Object.keys(health.ownershipCounts)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    )
    .join("");

  dom.statusFilter.innerHTML = ['<option value="">All</option>']
    .concat(
      Object.keys(health.statusCounts)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    )
    .join("");

  dom.departmentFilter.innerHTML = ['<option value="">All</option>']
    .concat(
      Object.keys(health.departmentCounts)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    )
    .join("");
}

function lateIndicator(activity) {
  const required = new Date(activity.materialRequiredDate || "");
  const received = new Date(activity.materialReceivedDate || "");
  if (Number.isNaN(required.getTime())) return "N/A";
  if (!Number.isNaN(received.getTime())) return received > required ? "Late Received" : "On Time";
  return required < new Date() ? "Required Date Missed" : "Pending";
}

function renderTable() {
  const ownership = dom.ownershipFilter.value;
  const status = dom.statusFilter.value;
  const department = dom.departmentFilter.value;

  const rows = health.enriched
    .filter((activity) => !ownership || activity.materialOwnership === ownership)
    .filter((activity) => !status || activity.materialStatus === status)
    .filter((activity) => !department || activity.resourceDepartment === department)
    .sort((left, right) => right.riskScore - left.riskScore);

  dom.tableSummary.textContent = `${rows.length} material lines`;

  if (!rows.length) {
    dom.tableBody.innerHTML = `<tr><td colspan="11"><div class="empty-state">No rows for selected filters.</div></td></tr>`;
    return;
  }

  dom.tableBody.innerHTML = rows
    .map((activity) => {
      const late = lateIndicator(activity);
      return `
        <tr>
          <td><strong>${escapeHtml(activity.activityId)}</strong></td>
          <td>${escapeHtml(activity.activityName || "-")}</td>
          <td><span class="${statusClass(activity.materialOwnership)}">${escapeHtml(activity.materialOwnership || "-")}</span></td>
          <td>${escapeHtml(activity.resourceDepartment || "-")}</td>
          <td>${escapeHtml(activity.requiredMaterials || "-")}</td>
          <td>${Number(activity.materialLeadTime) || 0}</td>
          <td><span class="${statusClass(activity.materialStatus)}">${escapeHtml(activity.materialStatus || "-")}</span></td>
          <td><span class="${statusClass(activity.materialCriticality)}">${escapeHtml(activity.materialCriticality || "-")}</span></td>
          <td>${formatDate(activity.materialRequiredDate)}</td>
          <td>${formatDate(activity.materialReceivedDate)}</td>
          <td><span class="${statusClass(late.includes("Late") || late.includes("Missed") ? "critical" : "medium")}">${late}</span></td>
        </tr>
      `;
    })
    .join("");
}

function wireEvents() {
  [dom.ownershipFilter, dom.statusFilter, dom.departmentFilter].forEach((node) => {
    node.addEventListener("change", renderTable);
  });
}

function restoreFilter(selectNode, value) {
  if (!selectNode) return;
  const hasOption = Array.from(selectNode.options).some((option) => option.value === value);
  selectNode.value = hasOption ? value : "";
}

function initialize() {
  setActiveNavigation();
  const currentUser = initializeAccessShell();
  if (!currentUser) return;
  wireEvents();
  initializeProjectToolbar({ onProjectChange: renderForActiveProject });
  const unsubscribe = subscribeToStateChanges(renderForActiveProject);
  window.addEventListener(
    "pagehide",
    () => {
      unsubscribe();
    },
    { once: true },
  );
  renderForActiveProject();
}

function renderForActiveProject() {
  const previousOwnership = dom.ownershipFilter.value;
  const previousStatus = dom.statusFilter.value;
  const previousDepartment = dom.departmentFilter.value;
  health = getMaterialHealth(getActivities());
  if (!health.enriched.length) {
    clearCharts();
    renderEmptyState(dom.kpiHost, "No material-linked activities available. Add data in Activity Master.");
    dom.tableSummary.textContent = "0 material lines";
    dom.tableBody.innerHTML = `<tr><td colspan="11"><div class="empty-state">No material records to display.</div></td></tr>`;
    return;
  }

  renderKpis();
  renderCharts();
  populateFilters();
  restoreFilter(dom.ownershipFilter, previousOwnership);
  restoreFilter(dom.statusFilter, previousStatus);
  restoreFilter(dom.departmentFilter, previousDepartment);
  renderTable();
}

initialize();
