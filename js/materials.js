import { getMaterialHealth } from "./analytics.js";
import { escapeHtml, formatDate, formatHours, renderEmptyState, setActiveNavigation, statusClass, toCsv, triggerDownload } from "./common.js";
import { getActivities, subscribeToStateChanges, updateActivity } from "./storage.js";
import { MATERIAL_STATUSES } from "./schema.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";

let ownershipChart;
let statusChart;
let timelineChart;
let health;

const dom = {
  kpiHost: document.querySelector("#material-kpis"),
  ownershipFilter: document.querySelector("#ownership-filter"),
  statusFilter: document.querySelector("#status-filter"),
  departmentFilter: document.querySelector("#department-filter"),
  tableBody: document.querySelector("#materials-table-body"),
  tableSummary: document.querySelector("#material-table-summary"),
  exportBtn: document.querySelector("#material-export-btn"),
  exportPendingBtn: document.querySelector("#material-export-pending-btn"),
  forecastList: document.querySelector("#material-forecast-list"),
  forecastHorizon: document.querySelector("#forecast-horizon"),
};

function renderKpis() {
  const total = health.enriched.length;
  const clientCount = health.enriched.filter((activity) =>
    String(activity.materialOwnership).toLowerCase().includes("client"),
  ).length;
  const mechanicalCount = health.enriched.filter((activity) =>
    String(activity.materialOwnership).toLowerCase().includes("mechanical"),
  ).length;
  const electricalCount = health.enriched.filter((activity) =>
    String(activity.materialOwnership).toLowerCase().includes("electrical"),
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
    { title: "Mechanical", value: mechanicalCount, note: "Mechanical internal ownership" },
    { title: "Electrical", value: electricalCount, note: "Electrical internal ownership" },
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
  if (timelineChart) {
    timelineChart.destroy();
    timelineChart = null;
  }
}

function renderTimelineChart() {
  const ctx = document.querySelector("#material-timeline-chart");
  if (!ctx) return;
  if (timelineChart) timelineChart.destroy();

  const items = health.enriched
    .filter((a) => a.materialRequiredDate || a.materialReceivedDate)
    .slice(0, 15);
  if (!items.length) {
    return;
  }

  const labels = items.map((a) => a.activityId || "");
  const required = items.map((a) => {
    const d = new Date(a.materialRequiredDate);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  });
  const received = items.map((a) => {
    const d = new Date(a.materialReceivedDate);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  });

  timelineChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Required Date (timestamp)",
          data: required,
          backgroundColor: "rgba(47, 143, 255, 0.6)",
        },
        {
          label: "Received Date (timestamp)",
          data: received,
          backgroundColor: "rgba(29, 184, 156, 0.6)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: {
        x: {
          ticks: {
            color: "#35567f",
            callback: (v) => {
              const d = new Date(v);
              return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
            },
          },
          grid: { color: "rgba(155, 185, 225, 0.55)" },
        },
        y: {
          ticks: { color: "#35567f" },
          grid: { color: "rgba(155, 185, 225, 0.35)" },
        },
      },
      plugins: {
        legend: { labels: { color: "#2f4f7a" } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              if (v == null) return ctx.dataset.label + ": -";
              const d = new Date(v);
              return ctx.dataset.label + ": " + (Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString());
            },
          },
        },
      },
    },
  });
}

function getMaterialNeededBy(activity) {
  const requiredDate = activity.materialRequiredDate ? new Date(activity.materialRequiredDate) : null;
  const plannedStart = activity.plannedStartDate ? new Date(activity.plannedStartDate) : null;
  const leadTimeHours = Number(activity.materialLeadTime) || 0;
  const leadTimeMs = leadTimeHours * 60 * 60 * 1000;
  const orderByDate = plannedStart && leadTimeHours > 0 ? new Date(plannedStart.getTime() - leadTimeMs) : null;
  if (requiredDate && orderByDate) return requiredDate < orderByDate ? requiredDate : orderByDate;
  return requiredDate || orderByDate;
}

function renderForecast() {
  const list = dom.forecastList;
  if (!list) return;
  const horizon = Number(dom.forecastHorizon?.value) || 14;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const future = new Date(now);
  future.setDate(future.getDate() + horizon);
  future.setHours(23, 59, 59, 999);

  const forecast = health.enriched
    .filter((a) => {
      const status = String(a.materialStatus || "").toLowerCase();
      if (status === "received") return false;
      const neededBy = getMaterialNeededBy(a);
      if (!neededBy || Number.isNaN(neededBy.getTime())) return false;
      return neededBy >= now && neededBy <= future;
    })
    .sort((a, b) => getMaterialNeededBy(a) - getMaterialNeededBy(b))
    .slice(0, 15);

  if (!forecast.length) {
    list.innerHTML = "<li class=\"empty-state\">No materials needed in the next " + horizon + " days.</li>";
    return;
  }

  list.innerHTML = forecast
    .map(
      (a) => `
    <li>
      <a href="activities.html?search=${encodeURIComponent(a.activityId)}" class="material-forecast-link">
        <strong>${escapeHtml(a.activityId)}</strong> – ${escapeHtml(a.requiredMaterials || "-")}
        <span class="small">Required: ${formatDate(a.materialRequiredDate)} | ${escapeHtml(a.materialCriticality || "-")}</span>
      </a>
    </li>
  `,
    )
    .join("");
}

function renderCharts() {
  const ownershipContext = document.querySelector("#ownership-chart");
  const statusContext = document.querySelector("#material-status-chart");
  if (ownershipChart) ownershipChart.destroy();
  if (statusChart) statusChart.destroy();

  const ownershipLabels = Object.keys(health.ownershipCounts);
  const ownershipValues = Object.values(health.ownershipCounts);
  const totalOwnership = ownershipValues.reduce((a, b) => a + b, 0);
  ownershipChart = new Chart(ownershipContext, {
    type: "pie",
    data: {
      labels: ownershipLabels,
      datasets: [
        {
          data: ownershipValues,
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
          labels: { color: "#2f4f7a" },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw || 0;
              const pct = totalOwnership ? ((v / totalOwnership) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${v} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  const statusLabels = Object.keys(health.statusCounts);
  const statusValues = Object.values(health.statusCounts);
  const totalStatus = statusValues.reduce((a, b) => a + b, 0);
  statusChart = new Chart(statusContext, {
    type: "bar",
    data: {
      labels: statusLabels,
      datasets: [
        {
          label: "Count",
          data: statusValues,
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
        legend: { labels: { color: "#2f4f7a" } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw || 0;
              const pct = totalStatus ? ((v / totalStatus) * 100).toFixed(1) : 0;
              return `Count: ${v} (${pct}%)`;
            },
          },
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
    dom.tableBody.innerHTML = `<tr><td colspan="12"><div class="empty-state">No rows for selected filters.</div></td></tr>`;
    return;
  }

  dom.tableBody.innerHTML = rows
    .map((activity) => {
      const late = lateIndicator(activity);
      const statusOpts = MATERIAL_STATUSES.map(
        (s) => `<option value="${escapeHtml(s)}" ${s === (activity.materialStatus || "") ? "selected" : ""}>${escapeHtml(s)}</option>`,
      ).join("");
      return `
        <tr data-activity-id="${escapeHtml(activity.activityId)}" class="material-row-clickable">
          <td><strong>${escapeHtml(activity.activityId)}</strong></td>
          <td>${escapeHtml(activity.activityName || "-")}</td>
          <td><span class="${statusClass(activity.materialOwnership)}">${escapeHtml(activity.materialOwnership || "-")}</span></td>
          <td><input type="text" class="material-supplier-input" value="${escapeHtml(activity.materialSupplier || "")}" placeholder="Vendor" data-activity-id="${escapeHtml(activity.activityId)}" style="min-width:100px" /></td>
          <td>${escapeHtml(activity.requiredMaterials || "-")}</td>
          <td>${Number(activity.materialLeadTime) || 0}</td>
          <td>
            <select class="material-status-select" data-activity-id="${escapeHtml(activity.activityId)}">${statusOpts}</select>
          </td>
          <td><span class="${statusClass(activity.materialCriticality)}">${escapeHtml(activity.materialCriticality || "-")}</span></td>
          <td>${formatDate(activity.materialRequiredDate)}</td>
          <td>${formatDate(activity.materialReceivedDate)}</td>
          <td><span class="${statusClass(late.includes("Late") || late.includes("Missed") ? "critical" : "medium")}">${late}</span></td>
        </tr>
      `;
    })
    .join("");

  dom.tableBody.querySelectorAll(".material-supplier-input").forEach((input) => {
    input.addEventListener("blur", () => {
      const id = input.dataset.activityId;
      if (id) updateActivity(id, { materialSupplier: input.value.trim() });
    });
  });
  dom.tableBody.querySelectorAll(".material-status-select").forEach((select) => {
    select.addEventListener("change", () => {
      const id = select.dataset.activityId;
      if (id) updateActivity(id, { materialStatus: select.value });
    });
  });
  dom.tableBody.querySelectorAll(".material-row-clickable").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("input") || e.target.closest("select")) return;
      const id = row.dataset.activityId;
      if (id) window.location.href = `activities.html?search=${encodeURIComponent(id)}`;
    });
  });
}

function exportMaterialsCsv() {
  const ownership = dom.ownershipFilter?.value || "";
  const status = dom.statusFilter?.value || "";
  const department = dom.departmentFilter?.value || "";
  const rows = health.enriched
    .filter((a) => !ownership || a.materialOwnership === ownership)
    .filter((a) => !status || a.materialStatus === status)
    .filter((a) => !department || a.resourceDepartment === department)
    .map((a) => ({
      "Activity ID": a.activityId,
      "Activity Name": a.activityName,
      Ownership: a.materialOwnership,
      "Supplier/Vendor": a.materialSupplier || "",
      Department: a.resourceDepartment,
      "Required Materials": a.requiredMaterials,
      "Lead Time (h)": a.materialLeadTime,
      "Material Status": a.materialStatus,
      Criticality: a.materialCriticality,
      "Required Date": formatDate(a.materialRequiredDate),
      "Received Date": formatDate(a.materialReceivedDate),
    }));
  triggerDownload(`materials_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), "text/csv;charset=utf-8;");
}

function exportPendingMaterials() {
  const pending = health.enriched.filter((a) => {
    const status = String(a.materialStatus || "").toLowerCase();
    return status !== "received";
  });
  const rows = pending.map((a) => ({
    "Activity ID": a.activityId,
    "Activity Name": a.activityName,
    Ownership: a.materialOwnership,
    "Supplier/Vendor": a.materialSupplier || "",
    "Required Materials": a.requiredMaterials,
    "Lead Time (h)": a.materialLeadTime,
    "Material Status": a.materialStatus,
    Criticality: a.materialCriticality,
    "Required Date": formatDate(a.materialRequiredDate),
  }));
  triggerDownload(`materials_pending_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), "text/csv;charset=utf-8;");
}

function wireEvents() {
  [dom.ownershipFilter, dom.statusFilter, dom.departmentFilter].forEach((node) => {
    node?.addEventListener("change", renderTable);
  });
  dom.forecastHorizon?.addEventListener("change", renderForecast);
  dom.forecastHorizon?.addEventListener("input", renderForecast);
  dom.exportBtn?.addEventListener("click", () => {
    if (!health?.enriched?.length) return;
    exportMaterialsCsv();
  });
  dom.exportPendingBtn?.addEventListener("click", () => {
    if (!health?.enriched?.length) return;
    exportPendingMaterials();
  });
}

function restoreFilter(selectNode, value) {
  if (!selectNode) return;
  const hasOption = Array.from(selectNode.options).some((option) => option.value === value);
  selectNode.value = hasOption ? value : "";
}

async function initialize() {
  await stateReady();
  initShell();
  setActiveNavigation();
  const currentUser = initializeAccessShell();
  if (!currentUser) return;
  wireEvents();
  initializeProjectToolbar({ mode: "switcher", onProjectChange: renderForActiveProject });
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
  renderTimelineChart();
  renderForecast();
  renderCharts();
  populateFilters();
  restoreFilter(dom.ownershipFilter, previousOwnership);
  restoreFilter(dom.statusFilter, previousStatus);
  restoreFilter(dom.departmentFilter, previousDepartment);
  renderTable();
}

initialize().catch((e) => console.error("[materials] init error:", e));
