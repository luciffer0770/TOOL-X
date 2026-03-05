/** Activity templates - save and load reusable activity presets */
import { createEmptyActivity, sanitizeActivity } from "./schema.js";
import { escapeHtml, showModal } from "./common.js";
import {
  addActivity,
  deleteActivityTemplate,
  getActivityTemplates,
  getDefaultEditor,
  saveActivityTemplate,
} from "./storage.js";
import { getCurrentUser } from "./auth.js";

export function openTemplatesModal({ onApply }) {
  const templates = getActivityTemplates();
  const user = getCurrentUser();
  const editor = getDefaultEditor() || user?.displayName || "Planner";

  const listHtml = templates.length
    ? templates
        .map(
          (t) => `
        <div class="template-item" data-id="${escapeHtml(t.id)}">
          <span class="template-name">${escapeHtml(t.name)}</span>
          <span class="template-preview">${escapeHtml((t.activity?.activityName || "").slice(0, 40))}${(t.activity?.activityName || "").length > 40 ? "…" : ""}</span>
          <div class="template-actions">
            <button type="button" class="ghost template-apply-btn">Use</button>
            <button type="button" class="ghost template-delete-btn">Delete</button>
          </div>
        </div>
      `
        )
        .join("")
    : '<div class="empty-state">No templates yet. Add an activity and click "Save as Template".</div>';

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width: 480px">
      <h2 class="modal-title">Activity Templates</h2>
      <div class="template-list">${listHtml}</div>
      <div class="modal-actions" style="margin-top: 12px">
        <button type="button" class="modal-secondary ghost">Close</button>
      </div>
    </div>
  `;

  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
  };

  overlay.querySelectorAll(".template-apply-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".template-item");
      const id = item?.dataset?.id;
      const t = templates.find((x) => x.id === id);
      if (t?.activity) {
        const draft = sanitizeActivity({
          ...t.activity,
          activityId: "",
          lastModifiedBy: editor,
          lastModifiedDate: new Date().toISOString().slice(0, 10),
        });
        addActivity(draft);
        if (typeof onApply === "function") onApply();
        close();
      }
    });
  });

  function attachHandlers() {
    overlay.querySelectorAll(".template-apply-btn").forEach((btn) => {
      btn.onclick = () => {
        const item = btn.closest(".template-item");
        const t = getActivityTemplates().find((x) => x.id === item?.dataset?.id);
        if (t?.activity) {
          const draft = sanitizeActivity({ ...t.activity, activityId: "", lastModifiedBy: editor, lastModifiedDate: new Date().toISOString().slice(0, 10) });
          addActivity(draft);
          if (typeof onApply === "function") onApply();
          close();
        }
      };
    });
    overlay.querySelectorAll(".template-delete-btn").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.closest(".template-item")?.dataset?.id;
        if (id) {
          deleteActivityTemplate(id);
          const updated = getActivityTemplates();
          const list = overlay.querySelector(".template-list");
          list.innerHTML = updated.length
            ? updated
                .map(
                  (t) => `
            <div class="template-item" data-id="${escapeHtml(t.id)}">
              <span class="template-name">${escapeHtml(t.name)}</span>
              <span class="template-preview">${escapeHtml((t.activity?.activityName || "").slice(0, 40))}${(t.activity?.activityName || "").length > 40 ? "…" : ""}</span>
              <div class="template-actions">
                <button type="button" class="ghost template-apply-btn">Use</button>
                <button type="button" class="ghost template-delete-btn">Delete</button>
              </div>
            </div>
          `
                )
                .join("")
            : '<div class="empty-state">No templates yet.</div>';
          attachHandlers();
        }
      };
    });
  }
  attachHandlers();

  overlay.querySelector(".modal-secondary").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
}

export async function saveCurrentAsTemplate(getActivityDraft, onSaved) {
  const result = await showModal({
    title: "Save as Template",
    body: "Enter a name for this activity template.",
    fields: [{ id: "name", label: "Template name", placeholder: "e.g. Standard Mechanical Task", required: true }],
    primaryLabel: "Save",
    secondaryLabel: "Cancel",
  });
  if (!result?.name?.trim()) return;
  const draft = typeof getActivityDraft === "function" ? getActivityDraft() : createEmptyActivity();
  saveActivityTemplate(result.name.trim(), draft);
  if (typeof onSaved === "function") onSaved();
}
