/** Risk Register - track and mitigate project risks */
import { escapeHtml, setActiveNavigation } from "./common.js";
import { getActivities, updateActivity } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";

function render() {
  const activities = getActivities();
  const rows = activities
    .filter((a) => (a.riskScore || 0) >= 40 || String(a.riskLevel || "").toLowerCase() === "high" || String(a.riskLevel || "").toLowerCase() === "critical")
    .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  const filter = document.getElementById("risk-filter")?.value || "";
  const filtered = filter ? rows.filter((r) => r.riskLevel === filter) : rows;
  const tbody = document.getElementById("risk-register-body");
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No high-risk activities.</div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (r) => `
    <tr data-activity-id="${escapeHtml(r.activityId)}">
      <td><a href="activities.html?search=${escapeHtml(r.activityId)}">${escapeHtml(r.activityId)}</a></td>
      <td>${escapeHtml(r.phase || "-")}</td>
      <td><span class="${r.activityStatus === "Delayed" ? "status-delayed" : ""}">${escapeHtml(r.activityStatus || "-")}</span></td>
      <td><span class="badge badge-${(r.riskLevel || "").toLowerCase()}">${escapeHtml(r.riskLevel || "-")}</span></td>
      <td>${r.riskScore ?? "-"}</td>
      <td>${escapeHtml(r.delayReason || "-")}</td>
      <td><input type="text" class="risk-mitigation-input" value="${escapeHtml(r.remarks || "")}" placeholder="Mitigation notes..." data-activity-id="${escapeHtml(r.activityId)}" /></td>
    </tr>
  `
    )
    .join("");

  tbody.querySelectorAll(".risk-mitigation-input").forEach((input) => {
    input.addEventListener("blur", () => {
      const id = input.dataset.activityId;
      const val = input.value?.trim() || "";
      if (id) updateActivity(id, { remarks: val });
    });
  });
}

async function initialize() {
  await stateReady();
  const user = initializeAccessShell({});
  if (!user) return;
  initShell();
  initializeProjectToolbar({ onProjectChange: render, onStateChange: render });
  setActiveNavigation();

  document.getElementById("risk-filter")?.addEventListener("change", render);
  window.addEventListener("industrial_planning_state_changed", render);
  render();
}
initialize().catch((e) => console.error("[risk-register] init:", e));
