/** Network diagram - activity dependencies visualization */
import { escapeHtml, setActiveNavigation } from "./common.js";
import { parseDependencies } from "./schema.js";
import { getActivities } from "./storage.js";
import { getBlockedActivities } from "./analytics.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";

function render() {
  const activities = getActivities();
  const byId = new Map(activities.map((a) => [a.activityId, a]));
  const blocked = new Set(getBlockedActivities(activities).map((a) => a.activityId));

  const container = document.getElementById("network-diagram");
  if (!container) return;

  if (!activities.length) {
    container.innerHTML = '<div class="empty-state">No activities. Add activities in Activity Master.</div>';
    return;
  }

  const rows = activities.map((a) => {
    const deps = parseDependencies(a.dependencies);
    const isBlocked = blocked.has(a.activityId);
    const depLinks = deps
      .map((d) => {
        const exists = byId.has(d);
        return `<a href="activities.html?search=${escapeHtml(d)}" class="network-dep ${exists ? "" : "missing"}">${escapeHtml(d)}</a>`;
      })
      .join(" → ");
    return `
      <div class="network-row ${isBlocked ? "blocked" : ""}">
        <span class="network-id"><a href="activities.html?search=${escapeHtml(a.activityId)}">${escapeHtml(a.activityId)}</a></span>
        <span class="network-name">${escapeHtml((a.activityName || "").slice(0, 40))}${(a.activityName || "").length > 40 ? "…" : ""}</span>
        <span class="network-deps">${deps.length ? depLinks : "—"}</span>
      </div>
    `;
  });

  container.innerHTML = rows.join("");
}

async function initialize() {
  await stateReady();
  const user = initializeAccessShell({});
  if (!user) return;
  initShell();
  initializeProjectToolbar({ onProjectChange: render, onStateChange: render });
  setActiveNavigation();

  window.addEventListener("industrial_planning_state_changed", render);
  render();
}
initialize().catch((e) => console.error("[network] init:", e));
