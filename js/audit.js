/**
 * Audit trail – change history log.
 */
import { escapeHtml } from "./common.js";
import { getAuthBearerHeaders } from "./auth.js";

const AUDIT_KEY = "atlas_planning_audit_v1";

function severityForAction(action) {
  const lc = String(action || "").toLowerCase();
  if (/(delete|clear|archive|restore|override)/.test(lc)) return "critical";
  if (/(import|bulk|export|login_fail|fail)/.test(lc)) return "warning";
  return "info";
}
const MAX_ENTRIES = 200;

function loadAuditLog() {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAuditLog(entries) {
  const trimmed = entries.slice(-MAX_ENTRIES);
  localStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed));
}

function mirrorAuditToServer(action, details) {
  const headers = {
    "Content-Type": "application/json",
    ...getAuthBearerHeaders(),
  };
  if (!headers.Authorization) return;
  fetch("/api/health")
    .then((h) => (h.ok ? fetch("/api/audit/log", { method: "POST", headers, body: JSON.stringify({ action, details }) }) : null))
    .catch(() => {});
}

export function logAudit(action, details = {}) {
  const entries = loadAuditLog();
  entries.push({
    at: new Date().toISOString(),
    action,
    ...details,
  });
  saveAuditLog(entries);
  mirrorAuditToServer(action, details);
}

export function getAuditLog() {
  return [...loadAuditLog()].reverse();
}

export function showAuditTrail() {
  const entries = getAuditLog();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay audit-trail-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="modal-dialog audit-trail-modal">
      <button type="button" class="audit-trail-close ghost" aria-label="Close">&times;</button>
      <div class="audit-trail-modal-header">
        <span class="audit-trail-modal-icon" aria-hidden="true">&#8987;</span>
        <h2 class="modal-title audit-trail-modal-title">Change History</h2>
      </div>
      <div class="audit-trail-modal-body">
        ${entries.length
          ? entries
              .slice(0, 50)
              .map((e) => {
                const sev = severityForAction(e.action);
                const id = e.activityId ? escapeHtml(e.activityId) : "";
                return `<div class="audit-trail-item-compact">
            <span class="audit-trail-time font-mono">${escapeHtml(new Date(e.at).toLocaleString())}</span>
            <span class="audit-severity-node audit-severity-node--${sev}" aria-hidden="true"><span></span></span>
            <span class="audit-trail-action-text">${escapeHtml(e.action)}</span>
            ${id ? `<span class="audit-entity-tag font-mono">${id}</span>` : ""}
          </div>`;
              })
              .join("")
          : '<p class="empty-state">No changes recorded yet.</p>'}
      </div>
      <div class="audit-trail-modal-footer">
        <button type="button" class="modal-secondary ghost">Close</button>
        <a href="audit-log.html" class="audit-trail-full-link">View full Audit Log &rarr;</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
  };
  overlay.querySelector(".audit-trail-close")?.addEventListener("click", close);
  overlay.querySelector(".modal-secondary")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
