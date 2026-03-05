/** Alert center - delays, risks, blocked activities */
import { getActivities } from "./storage.js";
import { getBlockedActivities, getDelayAndRiskRows } from "./analytics.js";
import { escapeHtml } from "./common.js";

export function getAlerts() {
  const activities = getActivities();
  const referenceDate = new Date();
  const delays = getDelayAndRiskRows(activities, referenceDate);
  const blocked = getBlockedActivities(activities);

  const alerts = [];
  delays.filter((r) => r.delayHours > 0).forEach((r) => {
    alerts.push({
      type: "delay",
      severity: "high",
      activityId: r.activityId,
      message: `${r.activityId} delayed by ${Math.round(r.delayHours)}h`,
      detail: r.delayReason || "Past due",
      link: "activities.html",
    });
  });
  delays.filter((r) => r.riskLevel === "High" || r.riskLevel === "Critical").forEach((r) => {
    alerts.push({
      type: "risk",
      severity: r.riskLevel === "Critical" ? "critical" : "high",
      activityId: r.activityId,
      message: `${r.activityId} - ${r.riskLevel} risk`,
      detail: `Score: ${r.riskScore}`,
      link: "intelligence.html",
    });
  });
  blocked.forEach((b) => {
    alerts.push({
      type: "blocked",
      severity: "medium",
      activityId: b.activityId,
      message: `${b.activityId} blocked by dependencies`,
      detail: (b.blockingDependencies || []).join(", ") || "",
      link: "gantt.html",
    });
  });

  return alerts.slice(0, 20);
}

export function renderAlertsDropdown(container) {
  const alerts = getAlerts();
  container.innerHTML = `
    <div class="alerts-dropdown-header">
      <strong>Alerts</strong>
      <span class="alerts-count">${alerts.length}</span>
    </div>
    <ul class="alerts-list">
      ${alerts.length
        ? alerts
            .map(
              (a) => `
        <li class="alerts-item severity-${a.severity}">
          <a href="${escapeHtml(a.link)}" class="alerts-item-link">
            <span class="alerts-item-type">${escapeHtml(a.type)}</span>
            <span class="alerts-item-msg">${escapeHtml(a.message)}</span>
            ${a.detail ? `<span class="alerts-item-detail">${escapeHtml(a.detail)}</span>` : ""}
          </a>
        </li>
      `
            )
            .join("")
        : '<li class="alerts-empty">No alerts</li>'}
    </ul>
  `;
}

export function initAlertsBell() {
  const existing = document.querySelector("#alerts-bell-wrap");
  if (existing) return;

  const sessionChip = document.querySelector(".session-chip");
  const wrap = document.createElement("div");
  wrap.id = "alerts-bell-wrap";
  wrap.className = "alerts-bell-wrap";
  wrap.innerHTML = `
    <button id="alerts-bell-btn" class="ghost" type="button" aria-label="Alerts" title="Alerts">
      🔔
      <span id="alerts-badge" class="alerts-badge"></span>
    </button>
    <div id="alerts-dropdown" class="alerts-dropdown" hidden></div>
  `;
  if (sessionChip?.parentElement) {
    sessionChip.parentElement.insertBefore(wrap, sessionChip);
  } else {
    return;
  }

  const btn = document.getElementById("alerts-bell-btn");
  const dropdown = document.getElementById("alerts-dropdown");
  const badge = document.getElementById("alerts-badge");

  function update() {
    const alerts = getAlerts();
    renderAlertsDropdown(dropdown);
    badge.textContent = alerts.length > 0 ? alerts.length : "";
    badge.hidden = alerts.length === 0;
  }

  const wrapEl = document.getElementById("alerts-bell-wrap");

  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.hidden;
    if (isOpen) {
      dropdown.hidden = true;
      return;
    }
    update();
    dropdown.hidden = false;
  });

  document.addEventListener("click", (e) => {
    if (wrapEl && wrapEl.contains(e.target)) return;
    if (dropdown?.contains(e.target)) return;
    dropdown.hidden = true;
  });
  dropdown?.addEventListener("click", (e) => e.stopPropagation());

  update();
  window.addEventListener("industrial_planning_state_changed", update);
}
