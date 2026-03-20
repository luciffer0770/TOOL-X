/** Risk Register - track and mitigate project risks */
import { escapeHtml, setActiveNavigation, toCsv, triggerDownload } from "./common.js";
import { enrichActivities } from "./analytics.js";
import { getActivities, getProjectActions, updateActivity } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";

const MITIGATION_STATUSES = ["Planned", "In Progress", "Done"];
const PROBABILITY_OPTIONS = [1, 2, 3, 4, 5];
const IMPACT_OPTIONS = [1, 2, 3, 4, 5];

function getEnrichedRows() {
  const activities = getActivities();
  const enriched = enrichActivities(activities);
  return enriched
    .filter(
      (a) =>
        (a.riskScore || 0) >= 40 ||
        String(a.riskLevel || "").toLowerCase() === "high" ||
        String(a.riskLevel || "").toLowerCase() === "critical",
    )
    .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
}

function render() {
  const rows = getEnrichedRows();
  const filter = document.getElementById("risk-filter")?.value || "";
  const filtered = filter ? rows.filter((r) => r.riskLevel === filter) : rows;
  const actions = getProjectActions();
  const actionByActivity = new Map(actions.filter((a) => a.activityId).map((a) => [a.activityId, a]));

  const tbody = document.getElementById("risk-register-body");
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="13"><div class="empty-state">No high-risk activities.</div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((r) => {
      const act = actionByActivity.get(r.activityId);
      const probOpts = PROBABILITY_OPTIONS.map((n) => `<option value="${n}" ${(r.riskProbability || 3) === n ? "selected" : ""}>${n}</option>`).join("");
      const impOpts = IMPACT_OPTIONS.map((n) => `<option value="${n}" ${(r.riskImpact || 3) === n ? "selected" : ""}>${n}</option>`).join("");
      const mitOpts = MITIGATION_STATUSES.map(
        (s) => `<option value="${escapeHtml(s)}" ${(r.riskMitigationStatus || "") === s ? "selected" : ""}>${escapeHtml(s)}</option>`,
      ).join("");
      const reviewDate = r.riskReviewDate || "";
      const isOverdue =
        reviewDate &&
        new Date(reviewDate) < new Date() &&
        String(r.riskMitigationStatus || "").toLowerCase() !== "done";

      return `
    <tr data-activity-id="${escapeHtml(r.activityId)}">
      <td><a href="activities.html?search=${escapeHtml(r.activityId)}">${escapeHtml(r.activityId)}</a></td>
      <td>${escapeHtml(r.phase || "-")}</td>
      <td><select class="risk-prob-select" data-activity-id="${escapeHtml(r.activityId)}">${probOpts}</select></td>
      <td><select class="risk-impact-select" data-activity-id="${escapeHtml(r.activityId)}">${impOpts}</select></td>
      <td><span class="${r.activityStatus === "Delayed" ? "badge badge-critical" : "badge badge-neutral"}">${escapeHtml(r.activityStatus || "-")}</span></td>
      <td><span class="badge badge-${(r.riskLevel || "").toLowerCase()}">${escapeHtml(r.riskLevel || "-")}</span></td>
      <td>${r.riskScore ?? "-"}</td>
      <td><select class="risk-mitigation-status-select" data-activity-id="${escapeHtml(r.activityId)}">${mitOpts}</select></td>
      <td><input type="text" class="risk-owner-input" value="${escapeHtml(r.riskOwner || "")}" placeholder="Owner" data-activity-id="${escapeHtml(r.activityId)}" style="min-width:90px" /></td>
      <td><input type="date" class="risk-review-date-input" value="${escapeHtml(reviewDate)}" data-activity-id="${escapeHtml(r.activityId)}" title="${isOverdue ? "Overdue review" : ""}" /></td>
      <td>${escapeHtml(r.delayReason || "-")}</td>
      <td><input type="text" class="risk-mitigation-input" value="${escapeHtml(r.remarks || "")}" placeholder="Mitigation notes..." data-activity-id="${escapeHtml(r.activityId)}" /></td>
      <td>${act ? `<a href="anomaly-center.html" class="badge badge-good">Action: ${escapeHtml(act.id)}</a>` : `<a href="anomaly-center.html?activity=${encodeURIComponent(r.activityId)}" class="ghost">Create Action</a>`}</td>
    </tr>
  `;
    })
    .join("");

  tbody.querySelectorAll(".risk-mitigation-input").forEach((input) => {
    input.addEventListener("blur", () => {
      const id = input.dataset.activityId;
      if (id) updateActivity(id, { remarks: input.value?.trim() || "" });
    });
  });
  tbody.querySelectorAll(".risk-prob-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.activityId;
      if (id) updateActivity(id, { riskProbability: Number(sel.value) });
    });
  });
  tbody.querySelectorAll(".risk-impact-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.activityId;
      if (id) updateActivity(id, { riskImpact: Number(sel.value) });
    });
  });
  tbody.querySelectorAll(".risk-mitigation-status-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.activityId;
      if (id) updateActivity(id, { riskMitigationStatus: sel.value });
    });
  });
  tbody.querySelectorAll(".risk-owner-input").forEach((input) => {
    input.addEventListener("blur", () => {
      const id = input.dataset.activityId;
      if (id) updateActivity(id, { riskOwner: input.value?.trim() || "" });
    });
  });
  tbody.querySelectorAll(".risk-review-date-input").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.activityId;
      if (id) updateActivity(id, { riskReviewDate: input.value || "" });
    });
  });
}

function exportRiskCsv() {
  const rows = getEnrichedRows();
  const filter = document.getElementById("risk-filter")?.value || "";
  const filtered = filter ? rows.filter((r) => r.riskLevel === filter) : rows;
  const data = filtered.map((r) => ({
    "Activity ID": r.activityId,
    Phase: r.phase,
    Probability: r.riskProbability ?? "",
    Impact: r.riskImpact ?? "",
    Status: r.activityStatus,
    "Risk Level": r.riskLevel,
    "Risk Score": r.riskScore,
    "Mitigation Status": r.riskMitigationStatus ?? "",
    "Risk Owner": r.riskOwner ?? "",
    "Review Date": r.riskReviewDate ?? "",
    "Delay Reason": r.delayReason ?? "",
    "Mitigation Notes": r.remarks ?? "",
  }));
  triggerDownload(`risk_register_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data), "text/csv;charset=utf-8;");
}

function exportRiskPdf() {
  const printWindow = window.open("", "_blank");
  const rows = getEnrichedRows();
  const filter = document.getElementById("risk-filter")?.value || "";
  const filtered = filter ? rows.filter((r) => r.riskLevel === filter) : rows;
  const rowsHtml = filtered
    .map(
      (r) =>
        `<tr>
          <td>${r.activityId}</td>
          <td>${r.phase || "-"}</td>
          <td>${r.riskProbability ?? "-"}</td>
          <td>${r.riskImpact ?? "-"}</td>
          <td>${r.riskLevel || "-"}</td>
          <td>${r.riskScore ?? "-"}</td>
          <td>${r.riskMitigationStatus ?? "-"}</td>
          <td>${r.riskOwner || "-"}</td>
          <td>${r.riskReviewDate || "-"}</td>
          <td>${(r.delayReason || "").slice(0, 40)}</td>
        </tr>`,
    )
    .join("");
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Risk Register Export</title>
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 6px; font-size: 11px; }
        th { background: #f0f0f0; }
      </style>
    </head>
    <body>
      <h1>Risk Register</h1>
      <p>Exported: ${new Date().toLocaleString()}</p>
      <table>
        <thead><tr><th>Activity</th><th>Phase</th><th>Prob</th><th>Impact</th><th>Level</th><th>Score</th><th>Mitigation</th><th>Owner</th><th>Review</th><th>Reason</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
  printWindow.close();
}

async function initialize() {
  await stateReady();
  const user = initializeAccessShell({});
  if (!user) return;
  initShell();
  initializeProjectToolbar({ mode: "switcher", onProjectChange: render });
  setActiveNavigation();

  document.getElementById("risk-filter")?.addEventListener("change", render);
  document.getElementById("risk-export-csv")?.addEventListener("click", exportRiskCsv);
  document.getElementById("risk-export-pdf")?.addEventListener("click", exportRiskPdf);
  window.addEventListener("industrial_planning_state_changed", render);
  render();
}
initialize().catch((e) => console.error("[risk-register] init:", e));
