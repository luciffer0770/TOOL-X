/** Calendar view - activities by planned dates */
import { escapeHtml, notify, setActiveNavigation, showModal } from "./common.js";
import { addActivity, getActivities, getDefaultEditor, subscribeToStateChanges, updateActivity } from "./storage.js";
import { createEmptyActivity } from "./schema.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";
import { canManageProjects, canModifyActivityStructure, getCurrentUser } from "./auth.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_CLASS = {
  completed: "cal-status-completed",
  delayed: "cal-status-delayed",
  "in progress": "cal-status-progress",
  blocked: "cal-status-blocked",
  "not started": "cal-status-pending",
};

function getStatusClass(activity) {
  const status = String(activity.activityStatus || "").toLowerCase().trim();
  return STATUS_CLASS[status] || "cal-status-pending";
}

let viewDate = new Date();
let viewMode = "month";
let selectedActivity = null;
let densityMode = "normal";
let todayCol = -1;

function getActivitiesForRange(activities, start, end) {
  return activities.filter((a) => {
    const d = a.plannedStartDate || a.plannedEndDate || a.actualStartDate;
    if (!d) return false;
    const date = new Date(d);
    return date >= start && date <= end;
  });
}

function renderMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 41);

  const activities = getActivities();
  const inRange = getActivitiesForRange(activities, start, end);

  const byDate = new Map();
  inRange.forEach((a) => {
    const d = a.plannedStartDate || a.plannedEndDate || a.actualStartDate;
    if (!d) return;
    const key = d.slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(a);
  });

  const todayKey = new Date().toISOString().slice(0, 10);
  const isViewingCurrentMonth = viewDate.getMonth() === new Date().getMonth() && viewDate.getFullYear() === new Date().getFullYear();
  todayCol = isViewingCurrentMonth ? new Date().getDay() : -1;
  let html = DAYS.map((d, i) => {
    return `<div class="cal-day-name ${i === todayCol ? "cal-today-col" : ""}" data-col="${i}">${d}</div>`;
  }).join("");

  for (let week = 0; week < 6; week++) {
    for (let day = 0; day < 7; day++) {
      const d = new Date(start);
      d.setDate(start.getDate() + week * 7 + day);
      const key = d.toISOString().slice(0, 10);
      const isCurrentMonth = d.getMonth() === month;
      const isToday = key === todayKey;
      const dayActivities = byDate.get(key) || [];
      const cls = [
        "cal-day",
        isCurrentMonth ? "cal-current-month" : "cal-other-month",
        isToday ? "cal-today" : "",
        day === todayCol ? "cal-today-col" : "",
      ].filter(Boolean).join(" ");
      const dayNum = isCurrentMonth ? String(d.getDate()) : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
      const countBadge = dayActivities.length > 0 ? `<span class="cal-count-badge" title="${dayActivities.length} activities">${dayActivities.length}</span>` : "";
      const eventHtml = dayActivities.slice(0, 4).map((a) => {
        const statusClass = getStatusClass(a);
        const isSelected = selectedActivity?.activityId === a.activityId;
        return `<button type="button" class="cal-event ${statusClass} ${isSelected ? "cal-event-selected" : ""}" draggable="true" data-activity-id="${escapeHtml(a.activityId)}" data-date-key="${escapeHtml(key)}" title="${escapeHtml(a.activityName || a.activityId)}">${escapeHtml(a.activityId)}</button>`;
      }).join("");
      html += `<div class="${cls}" data-date-key="${key}" data-col="${day}" data-day-index="${week * 7 + day}">
        <div class="cal-day-num-wrap">
          <span class="cal-day-num">${dayNum}</span>${countBadge}
        </div>
        <div class="cal-day-events cal-drop-target">${eventHtml}
        ${dayActivities.length > 4 ? `<span class="cal-more">+${dayActivities.length - 4}</span>` : ""}
        </div>
      </div>`;
    }
  }

  const legendHtml = `
    <div class="calendar-legend-items">
      <span class="cal-legend-item cal-status-completed">Completed</span>
      <span class="cal-legend-item cal-status-delayed">Delayed</span>
      <span class="cal-legend-item cal-status-progress">In Progress</span>
      <span class="cal-legend-item cal-status-pending">Not Started</span>
      <span class="cal-legend-hint">Drag to reschedule · Double-click empty day to add · Arrows to navigate</span>
    </div>
  `;

  return { html, legendHtml, title: `${MONTHS[month]} ${year}` };
}

function showActivityDetail(activity) {
  const placeholder = document.getElementById("calendar-detail-placeholder");
  const content = document.getElementById("calendar-detail-content");
  const titleEl = document.getElementById("calendar-detail-title");
  const metaEl = document.getElementById("calendar-detail-meta");
  const linkEl = document.getElementById("calendar-detail-link");

  if (!activity) {
    if (placeholder) placeholder.hidden = false;
    if (content) content.hidden = true;
    selectedActivity = null;
    return;
  }

  selectedActivity = activity;
  if (placeholder) placeholder.hidden = true;
  if (content) content.hidden = false;
  if (titleEl) titleEl.textContent = activity.activityName || activity.activityId;
  if (metaEl) {
    metaEl.innerHTML = `
      <div><strong>${escapeHtml(activity.activityId)}</strong></div>
      <div>Phase: ${escapeHtml(activity.phase || "-")}</div>
      <div>Status: ${escapeHtml(activity.activityStatus || "-")}</div>
      <div>Planned: ${escapeHtml(activity.plannedStartDate || "-")} to ${escapeHtml(activity.plannedEndDate || "-")}</div>
      ${activity.completionPercentage != null ? `<div>Completion: ${activity.completionPercentage}%</div>` : ""}
    `;
  }
  if (linkEl) {
    linkEl.href = `activities.html?search=${encodeURIComponent(activity.activityId)}`;
    linkEl.textContent = "Open in Activity Master →";
  }
}

function render() {
  const grid = document.getElementById("calendar-grid");
  const legend = document.getElementById("calendar-legend");
  const titleEl = document.querySelector(".panel-header h2");
  if (!grid) return;
  const result = viewMode === "month" ? renderMonth(viewDate) : renderMonth(viewDate);
  grid.innerHTML = result.html;
  if (legend) legend.innerHTML = result.legendHtml || "";
  if (titleEl) titleEl.textContent = `Calendar – ${result.title}`;

  const subtitleEl = document.querySelector(".panel-header .panel-subtitle");
  if (subtitleEl) {
    const count = getActivities().length;
    subtitleEl.textContent = `Activities by planned dates · ${count} total`;
  }

  grid.querySelectorAll(".cal-event").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const id = btn.dataset.activityId;
      const activities = getActivities();
      const activity = activities.find((a) => a.activityId === id);
      if (activity && selectedActivity?.activityId === id) {
        showActivityDetail(null);
      } else {
        showActivityDetail(activity || null);
      }
      render();
    });
  });

  wireDragAndDrop(grid);
  wireQuickAdd(grid);

  const detailEl = document.getElementById("calendar-detail");
  if (detailEl) {
    detailEl.querySelector(".calendar-detail-placeholder")?.addEventListener("click", () => {
      showActivityDetail(null);
      render();
    });
  }
}

function wireDragAndDrop(grid) {
  if (!canModifyActivityStructure(getCurrentUser())) return;
  let draggedId = null;
  grid.querySelectorAll(".cal-event").forEach((btn) => {
    btn.addEventListener("dragstart", (e) => {
      draggedId = btn.dataset.activityId;
      e.dataTransfer.setData("text/plain", draggedId);
      e.dataTransfer.effectAllowed = "move";
      btn.classList.add("cal-dragging");
    });
    btn.addEventListener("dragend", () => {
      btn.classList.remove("cal-dragging");
      draggedId = null;
    });
  });
  grid.querySelectorAll(".cal-day").forEach((cell) => {
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      cell.classList.add("cal-drop-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("cal-drop-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("cal-drop-over");
      const id = e.dataTransfer.getData("text/plain");
      const targetKey = cell.dataset.dateKey;
      if (!id || !targetKey) return;
      const activities = getActivities();
      const activity = activities.find((a) => a.activityId === id);
      if (!activity) return;
      const durationHours = activity.plannedDurationHours || activity.baseEffortHours || 24;
      const startDate = targetKey;
      const endDate = new Date(targetKey);
      endDate.setDate(endDate.getDate() + Math.ceil(durationHours / 24));
      updateActivity(id, {
        plannedStartDate: startDate,
        plannedEndDate: endDate.toISOString().slice(0, 10),
      });
      notify(`Moved ${id} to ${targetKey}`);
      render();
    });
  });
}

function wireQuickAdd(grid) {
  if (!canModifyActivityStructure(getCurrentUser())) return;
  grid.querySelectorAll(".cal-day").forEach((cell) => {
    cell.addEventListener("dblclick", (e) => {
      if (e.target.closest(".cal-event")) return;
      const key = cell.dataset.dateKey;
      if (!key) return;
      showModal({
        title: "Quick-add activity",
        body: `Create a new activity for ${key}.`,
        fields: [
          { id: "name", label: "Activity name", required: true, placeholder: "New activity" },
          { id: "phase", label: "Phase", placeholder: "Preparation" },
        ],
        primaryLabel: "Add",
        secondaryLabel: "Cancel",
      }).then((data) => {
        if (!data || !data.name) return;
        const draft = createEmptyActivity();
        draft.activityName = data.name;
        draft.phase = data.phase || "Preparation";
        draft.plannedStartDate = key;
        draft.plannedEndDate = key;
        draft.lastModifiedBy = getDefaultEditor();
        const added = addActivity(draft);
        notify(`Added ${added.activityId}`);
        render();
      });
    });
  });
}

let keyHandlerAttached = false;

function wireKeyboard() {
  if (keyHandlerAttached) return;
  keyHandlerAttached = true;
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input") || e.target.closest("textarea") || e.target.closest("select")) return;
    const grid = document.getElementById("calendar-grid");
    if (!grid) return;
    if (e.key === "Escape") {
      showActivityDetail(null);
      render();
      return;
    }
    const events = grid.querySelectorAll(".cal-event");
    const focused = document.activeElement;
    if (!focused?.classList.contains("cal-event")) return;
    const idx = [...events].indexOf(focused);
    if (idx === -1) return;
    let next = null;
    if (e.key === "ArrowLeft") next = events[idx - 1];
    if (e.key === "ArrowRight") next = events[idx + 1];
    if (e.key === "ArrowUp") next = events[Math.max(0, idx - 7)];
    if (e.key === "ArrowDown") next = events[Math.min(events.length - 1, idx + 7)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  });
}

async function initialize() {
  await stateReady();
  const user = initializeAccessShell({});
  if (!user) return;
  initShell();
  initializeProjectToolbar({ mode: "switcher", onProjectChange: render });
  subscribeToStateChanges(render);
  setActiveNavigation();
  wireKeyboard();

  const prevBtn = document.getElementById("cal-prev-btn");
  const nextBtn = document.getElementById("cal-next-btn");
  const todayBtn = document.getElementById("cal-today-btn");
  const viewSelect = document.getElementById("cal-view");

  prevBtn?.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    render();
  });
  nextBtn?.addEventListener("click", () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    render();
  });
  todayBtn?.addEventListener("click", () => {
    viewDate = new Date();
    render();
  });
  viewSelect?.addEventListener("change", (e) => {
    viewMode = e.target.value;
    render();
  });

  const densitySelect = document.getElementById("cal-density");
  densitySelect?.addEventListener("change", (e) => {
    densityMode = e.target.value;
    applyDensity();
  });

  render();
  densityMode = densitySelect?.value || "normal";
  applyDensity();
}

function applyDensity() {
  const gridEl = document.getElementById("calendar-grid");
  if (!gridEl) return;
  gridEl.classList.remove("cal-density-compact", "cal-density-expanded");
  if (densityMode === "compact") gridEl.classList.add("cal-density-compact");
  if (densityMode === "expanded") gridEl.classList.add("cal-density-expanded");
}
initialize().catch((e) => console.error("[calendar] init:", e));
