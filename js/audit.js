/**
 * Audit trail – change history log.
 */
import { escapeHtml } from "./common.js";

const AUDIT_KEY = "atlas_planning_audit_v1";
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

export function logAudit(action, details = {}) {
  const entries = loadAuditLog();
  entries.push({
    at: new Date().toISOString(),
    action,
    ...details,
  });
  saveAuditLog(entries);
}

export function getAuditLog() {
  return [...loadAuditLog()].reverse();
}

export function showAuditTrail() {
  const entries = getAuditLog();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width: 520px; max-height: 80vh">
      <h2 class="modal-title">Change History</h2>
      <div class="audit-trail-list" style="max-height: 400px; overflow-y: auto">
        ${entries.length ? entries.slice(0, 50).map((e) => `
          <div class="audit-trail-item">
            <span class="audit-trail-time">${new Date(e.at).toLocaleString()}</span>
            <span class="audit-trail-action">${escapeHtml(e.action)}</span>
            ${e.activityId ? `<span class="small">${escapeHtml(e.activityId)}</span>` : ""}
          </div>
        `).join("") : '<p class="empty-state">No changes recorded yet.</p>'}
      </div>
      <div class="modal-actions" style="margin-top: 12px">
        <button type="button" class="modal-secondary ghost">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  const close = () => { overlay.remove(); document.body.style.overflow = ""; };
  overlay.querySelector(".modal-secondary").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}
