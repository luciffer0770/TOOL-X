/** Activity comments - view and add comments */
import { escapeHtml, showModal } from "./common.js";
import { getCurrentUser } from "./auth.js";
import { addActivityComment, getActivities } from "./storage.js";

export function openCommentsModal(activityId, onUpdate) {
  const activities = getActivities();
  const activity = activities.find((a) => a.activityId === activityId);
  if (!activity) return;
  const comments = activity.comments || [];
  const user = getCurrentUser();
  const author = user?.displayName || user?.username || "Planner";

  const listHtml = comments.length
    ? comments
        .map(
          (c) => `
        <div class="comment-item">
          <div class="comment-meta"><strong>${escapeHtml(c.author)}</strong> · ${new Date(c.createdAt).toLocaleString()}</div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
      `
        )
        .join("")
    : '<div class="empty-state">No comments yet.</div>';

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-dialog" style="max-width: 480px">
      <h2 class="modal-title">Comments – ${escapeHtml(activityId)}</h2>
      <p class="modal-body">${escapeHtml(activity.activityName || "")}</p>
      <div class="comment-list">${listHtml}</div>
      <label class="field" style="margin-top: 12px">Add comment
        <textarea id="comment-new-text" placeholder="Type a comment... (@user to mention)" rows="2"></textarea>
      </label>
      <div class="modal-actions" style="margin-top: 12px">
        <button type="button" class="modal-secondary ghost">Close</button>
        <button type="button" class="modal-primary" id="comment-add-btn">Add</button>
      </div>
    </div>
  `;

  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
    if (typeof onUpdate === "function") onUpdate();
  };

  overlay.querySelector("#comment-add-btn")?.addEventListener("click", () => {
    const textarea = overlay.querySelector("#comment-new-text");
    const text = textarea?.value?.trim();
    if (!text) return;
    addActivityComment(activityId, text, author);
    textarea.value = "";
    const updated = getActivities().find((a) => a.activityId === activityId);
    const comments = updated?.comments || [];
    const list = overlay.querySelector(".comment-list");
    if (list) {
      list.innerHTML = comments.map((c) => `
        <div class="comment-item">
          <div class="comment-meta"><strong>${escapeHtml(c.author)}</strong> · ${new Date(c.createdAt).toLocaleString()}</div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>
      `).join("") || '<div class="empty-state">No comments yet.</div>';
    }
    if (typeof onUpdate === "function") onUpdate();
  });

  overlay.querySelector(".modal-secondary").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";
  overlay.querySelector("#comment-new-text")?.focus();
}
