import { computePortfolioMetrics, getDelayAndRiskRows, runScenarioSimulation } from "./analytics.js";
import { escapeHtml, formatHours, notify, setActiveNavigation, statusClass } from "./common.js";
import { getActivities, subscribeToStateChanges, updateActivity } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { canRunOptimization } from "./auth.js";

const dom = {
  riskKpis: document.querySelector("#risk-kpis"),
  rootCauseActivity: document.querySelector("#root-cause-activity"),
  rootCauseStatus: document.querySelector("#root-cause-status"),
  rootCauseCompletion: document.querySelector("#root-cause-completion"),
  rootCauseAuthor: document.querySelector("#root-cause-author"),
  rootCauseText: document.querySelector("#root-cause-text"),
  saveRootCauseButton: document.querySelector("#save-root-cause-btn"),
  blockedList: document.querySelector("#blocked-activities-list"),
  riskTableBody: document.querySelector("#delay-risk-table-body"),
  simManpower: document.querySelector("#sim-manpower"),
  simLeadTime: document.querySelector("#sim-leadtime"),
  simOvertime: document.querySelector("#sim-overtime"),
  runSimButton: document.querySelector("#run-sim-btn"),
  simPresetOvertime: document.querySelector("#sim-preset-overtime"),
  simPresetManpower: document.querySelector("#sim-preset-manpower"),
  simPresetLeadtime: document.querySelector("#sim-preset-leadtime"),
  simSummary: document.querySelector("#sim-summary"),
  simTableBody: document.querySelector("#sim-table-body"),
};

const SCENARIO_PRESETS = {
  overtime: { manpower: 0, leadtime: 0, overtime: 3 },
  manpower: { manpower: 20, leadtime: 0, overtime: 0 },
  leadtime: { manpower: 0, leadtime: 25, overtime: 0 },
};

let activities = [];
let currentUser = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function refreshActivities() {
  activities = getActivities();
}

function renderKpis() {
  const metrics = computePortfolioMetrics(activities);
  const critical = metrics.enriched.filter((activity) => activity.riskScore >= 75).length;
  const high = metrics.enriched.filter((activity) => activity.riskScore >= 55 && activity.riskScore < 75).length;
  const medium = metrics.enriched.filter((activity) => activity.riskScore >= 30 && activity.riskScore < 55).length;
  const low = metrics.enriched.filter((activity) => activity.riskScore < 30).length;

  const cards = [
    { title: "Total Activities", value: metrics.totalActivities, note: "Current execution model" },
    { title: "Delayed Activities", value: metrics.delayed, note: "Schedule overrun detected" },
    { title: "Critical Risk", value: critical, note: "Risk score >= 75" },
    { title: "High Risk", value: high, note: "Risk score 55-74" },
    { title: "Medium Risk", value: medium, note: "Risk score 30-54" },
    { title: "Low Risk", value: low, note: "Risk score below 30" },
  ];
  dom.riskKpis.innerHTML = cards
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

  return metrics;
}

function renderRootCauseSelector(rows) {
  const options = ['<option value="">Select delayed activity</option>']
    .concat(rows.map((row) => `<option value="${escapeHtml(row.activityId)}">${escapeHtml(row.activityId)} - ${escapeHtml(row.activityName || "-")}</option>`))
    .join("");
  dom.rootCauseActivity.innerHTML = options;
}

function renderBlockedList(metrics) {
  if (!metrics.blockedActivities.length) {
    dom.blockedList.innerHTML = `<li>No dependency stress nodes currently active.</li>`;
    return;
  }

  dom.blockedList.innerHTML = metrics.blockedActivities
    .slice(0, 12)
    .map(
      (activity) => `
      <li>
        <strong>${escapeHtml(activity.activityId)}</strong> - ${escapeHtml(activity.activityName || "-")}
        <div class="small">Blocking dependencies: ${escapeHtml(activity.blockingDependencies.join(", "))}</div>
      </li>
    `,
    )
    .join("");
}

function renderRiskTable(rows) {
  if (!rows.length) {
    dom.riskTableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No delayed or elevated-risk activities found.</div></td></tr>`;
    return;
  }

  dom.riskTableBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td><strong>${escapeHtml(row.activityId)}</strong><br /><span class="small">${escapeHtml(row.activityName || "-")}</span></td>
        <td><span class="${statusClass(row.activityStatus)}">${escapeHtml(row.activityStatus || "-")}</span></td>
        <td>
          <div class="progress"><span style="width:${Number(row.completionPercentage) || 0}%"></span></div>
          <div class="small">${Number(row.completionPercentage) || 0}%</div>
        </td>
        <td>${formatHours(row.delayHours)}</td>
        <td>${row.riskScore}</td>
        <td><span class="${statusClass(row.riskLevel)}">${escapeHtml(row.riskLevel)}</span></td>
        <td>${escapeHtml(row.materialStatus || "-")} / ${escapeHtml(row.materialCriticality || "-")}</td>
        <td>${escapeHtml(row.delayReason || "-")}</td>
      </tr>
    `,
    )
    .join("");
}

function isStatusDelayed(row) {
  return String(row?.activityStatus ?? "").trim().toLowerCase() === "delayed";
}

function renderSimulation() {
  if (!canRunOptimization(currentUser)) {
    dom.simSummary.textContent = "Scenario simulation is available for planning and management roles.";
    dom.simTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Simulation access is restricted for this role.</div></td></tr>`;
    return;
  }
  if (!activities.length) {
    dom.simSummary.textContent = "No activities available for simulation.";
    dom.simTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Add activities before running what-if simulation.</div></td></tr>`;
    return;
  }

  const scenario = {
    manpowerBoostPct: Number(dom.simManpower.value) || 0,
    leadTimeReductionPct: Number(dom.simLeadTime.value) || 0,
    overtimeHoursPerDay: Number(dom.simOvertime.value) || 0,
  };
  const result = runScenarioSimulation(activities, scenario);

  dom.simSummary.textContent = `Baseline finish: ${result.baselineFinishDate || "-"} | Simulated finish: ${result.simulatedFinishDate || "-"} | Net improvement: ${formatHours(result.improvementHours)}`;

  if (!result.impacts.length) {
    dom.simTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Simulation did not produce impact rows.</div></td></tr>`;
    return;
  }

  dom.simTableBody.innerHTML = result.impacts
    .slice(0, 12)
    .map(
      (impact) => `
      <tr>
        <td><strong>${escapeHtml(impact.activityId)}</strong><br /><span class="small">${escapeHtml(impact.activityName || "-")}</span></td>
        <td>${impact.baselineDurationHours}</td>
        <td>${impact.durationHours}</td>
        <td><span class="${statusClass(impact.savedHours > 0 ? "completed" : "medium")}">${impact.savedHours}</span></td>
        <td>${escapeHtml(impact.finishDate)}</td>
      </tr>
    `,
    )
    .join("");
}

function renderAll() {
  refreshActivities();
  const metrics = renderKpis();
  const riskRows = getDelayAndRiskRows(activities);
  renderRootCauseSelector(riskRows.filter((row) => row.delayHours > 0 || isStatusDelayed(row)));
  renderBlockedList(metrics);
  renderRiskTable(riskRows);
  renderSimulation();
}

function wireEvents() {
  dom.saveRootCauseButton.addEventListener("click", () => {
    const activityId = dom.rootCauseActivity.value;
    if (!activityId) {
      notify("Select an activity before saving root cause.", "warning");
      return;
    }
    const patch = {
      delayReason: dom.rootCauseText.value.trim(),
      activityStatus: dom.rootCauseStatus.value,
      lastModifiedBy: currentUser?.displayName || dom.rootCauseAuthor?.value?.trim() || "Planner",
      lastModifiedDate: new Date().toISOString().slice(0, 10),
    };
    patch.completionPercentage = Number(dom.rootCauseCompletion?.value) || 0;
    updateActivity(activityId, patch);
    notify(`Root cause updated for ${activityId}.`, "success");
    dom.rootCauseText.value = "";
    renderAll();
  });

  dom.runSimButton.addEventListener("click", renderSimulation);

  dom.simPresetOvertime?.addEventListener("click", () => {
    dom.simManpower.value = SCENARIO_PRESETS.overtime.manpower;
    dom.simLeadTime.value = SCENARIO_PRESETS.overtime.leadtime;
    dom.simOvertime.value = SCENARIO_PRESETS.overtime.overtime;
    renderSimulation();
  });
  dom.simPresetManpower?.addEventListener("click", () => {
    dom.simManpower.value = SCENARIO_PRESETS.manpower.manpower;
    dom.simLeadTime.value = SCENARIO_PRESETS.manpower.leadtime;
    dom.simOvertime.value = SCENARIO_PRESETS.manpower.overtime;
    renderSimulation();
  });
  dom.simPresetLeadtime?.addEventListener("click", () => {
    dom.simManpower.value = SCENARIO_PRESETS.leadtime.manpower;
    dom.simLeadTime.value = SCENARIO_PRESETS.leadtime.leadtime;
    dom.simOvertime.value = SCENARIO_PRESETS.leadtime.overtime;
    renderSimulation();
  });
}

function initialize() {
  initShell();
  setActiveNavigation();
  currentUser = initializeAccessShell();
  if (!currentUser) return;
  if (dom.rootCauseAuthor) {
    dom.rootCauseAuthor.value = currentUser.displayName || currentUser.username || "Planner";
  }
  if (!canRunOptimization(currentUser)) {
    if (dom.rootCauseCompletion) dom.rootCauseCompletion.disabled = true;
    if (dom.rootCauseAuthor) dom.rootCauseAuthor.readOnly = true;
    if (dom.runSimButton) dom.runSimButton.disabled = true;
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
