import { enrichActivities, getCriticalPath, getDependencyHealth, getTimelineBounds, parseDate } from "./analytics.js";
import { escapeHtml, formatDate, formatHours, notify, renderEmptyState, setActiveNavigation, statusClass } from "./common.js";
import { getActivities, subscribeToStateChanges, updateActivity } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";
import { normalizePhase, parseDependencies } from "./schema.js";

const dom = {
  phaseFilter: document.querySelector("#phase-filter"),
  statusFilter: document.querySelector("#status-filter"),
  rangeStart: document.querySelector("#range-start"),
  rangeEnd: document.querySelector("#range-end"),
  sortMode: document.querySelector("#sort-mode"),
  zoomMode: document.querySelector("#zoom-mode"),
  applyButton: document.querySelector("#apply-filters-btn"),
  resetRangeButton: document.querySelector("#reset-range-btn"),
  todayButton: document.querySelector("#today-btn"),
  ganttContainer: document.querySelector("#gantt-container"),
  ganttGrid: document.querySelector("#gantt-grid"),
  ganttSummary: document.querySelector("#gantt-summary"),
  dependencyBody: document.querySelector("#dependency-table-body"),
};

let activities = [];
let bounds = getTimelineBounds([]);
let dependencyHealth = getDependencyHealth([]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateShort(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateCompact(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTH_ABBR[date.getMonth()]}`;
}


function dateToMidnight(d) {
  if (!d || Number.isNaN(d.getTime())) return null;
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Parse YYYY-MM-DD as local date to avoid timezone shifts. */
function parseDateLocal(value) {
  if (!value) return null;
  const str = String(value).trim().slice(0, 10);
  if (str.length < 10) return null;
  const parts = str.split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  const date = new Date(y, m, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

const MAX_DATE_TICKS = 90;

function getDateTicks(rangeStart, rangeEnd) {
  const startMs = dateToMidnight(rangeStart)?.getTime() ?? rangeStart.getTime();
  const endMs = dateToMidnight(rangeEnd)?.getTime() ?? rangeEnd.getTime();
  const spanDays = (endMs - startMs) / MS_PER_DAY;
  let stepDays = 1;
  if (spanDays > 180) stepDays = 14;
  else if (spanDays > 90) stepDays = 7;
  const spanMs = endMs - startMs;
  const ticks = [];
  let d = new Date(startMs);
  const endTime = endMs;
  let count = 0;
  while (d.getTime() <= endTime && count < MAX_DATE_TICKS) {
    const pct = spanMs > 0 ? ((d.getTime() - startMs) / spanMs) * 100 : 0;
    const isMonthStart = d.getDate() === 1;
    ticks.push({ date: new Date(d), pct, isMonthStart });
    d.setDate(d.getDate() + stepDays);
    count++;
  }
  if (ticks.length > 0 && spanMs > 0) {
    const last = ticks[ticks.length - 1];
    const endDate = new Date(endMs);
    if (last.pct < 99.5 && endDate.getTime() !== last.date.getTime()) {
      ticks.push({ date: endDate, pct: 100, isMonthStart: endDate.getDate() === 1 });
    }
  }
  return { ticks, spanMs };
}

function getZoomDays() {
  const zoom = dom.zoomMode?.value || "week";
  if (zoom === "day") return 14;
  if (zoom === "month") return 90;
  return 45;
}

function populateFilters() {
  const phaseValues = [...new Set(activities.map((a) => normalizePhase(a.phase)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  dom.phaseFilter.innerHTML = ['<option value="">All</option>']
    .concat(phaseValues.map((phase) => `<option value="${escapeHtml(phase)}">${escapeHtml(phase)}</option>`))
    .join("");

  const statusValues = [...new Set(activities.map((activity) => activity.activityStatus).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
  dom.statusFilter.innerHTML = ['<option value="">All</option>']
    .concat(statusValues.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`))
    .join("");
}

function sortRows(rows) {
  switch (dom.sortMode.value) {
    case "risk":
      return rows.sort((left, right) => right.riskScore - left.riskScore);
    case "delay":
      return rows.sort((left, right) => right.delayHours - left.delayHours);
    case "completion":
      return rows.sort((left, right) => right.completionPercentage - left.completionPercentage);
    default:
      return rows.sort((left, right) => String(left.plannedStartDate || "").localeCompare(String(right.plannedStartDate || "")));
  }
}

function activeRange() {
  const start = parseDate(dom.rangeStart.value) || bounds.min;
  const end = parseDate(dom.rangeEnd.value) || bounds.max;
  if (end <= start) {
    notify("Timeline 'To' date must be after 'From' date.", "warning");
    return { start: bounds.min, end: bounds.max };
  }
  return { start, end };
}

function renderGantt() {
  const { start, end } = activeRange();
  const phaseFilter = dom.phaseFilter.value;
  const statusFilter = dom.statusFilter.value;
  const startMs = dateToMidnight(start)?.getTime() ?? start.getTime();
  const endMs = dateToMidnight(end)?.getTime() ?? end.getTime();
  const spanMs = endMs - startMs;
  const criticalPath = getCriticalPath(activities);
  const criticalSet = new Set(criticalPath.path);

  const rows = sortRows(
    activities
      .filter((activity) => !phaseFilter || normalizePhase(activity.phase) === phaseFilter)
      .filter((activity) => !statusFilter || activity.activityStatus === statusFilter),
  );

  const dependencyIssueCount = dependencyHealth.activitiesWithMissingDependencies + dependencyHealth.cycleCount;
  dom.ganttSummary.textContent = `${rows.length} activities | ${formatDate(start)} to ${formatDate(end)} | Critical: ${criticalPath.path.length} | Issues: ${dependencyIssueCount}`;

  if (!rows.length) {
    renderEmptyState(
      dom.ganttGrid,
      "No activities match the selected filters.",
      "Try adjusting Phase/Status filters.",
    );
    renderDependencyTable([]);
    return;
  }

  const today = dateToMidnight(new Date());
  const todayPct =
    today && spanMs > 0 && today.getTime() >= startMs && today.getTime() <= endMs
      ? ((today.getTime() - startMs) / spanMs) * 100
      : null;

  const { ticks: dateTicks } = getDateTicks(start, end);
  const dateTickHtml = dateTicks
    .map(
      (t) =>
        `<span class="gantt-date-tick ${t.isMonthStart ? "gantt-date-tick-month" : ""}" style="left:${t.pct}%">${formatDateCompact(t.date)}</span>`,
    )
    .join("");
  const gridLinesHtml = dateTicks.map((t) => `<div class="gantt-grid-line-vert" style="left:${t.pct}%"></div>`).join("");
  const todayMarkerHtml =
    todayPct != null ? `<div class="gantt-today-marker" style="left:${todayPct}%" aria-hidden="true"></div>` : "";

  const headerSpacer = `<div class="gantt-header-spacer" style="grid-row:1"><span class="gantt-header-label">Activity</span></div>`;
  const headerDates = `<div class="gantt-header-dates" style="grid-row:1">
    <div class="gantt-date-axis-grid">${gridLinesHtml}</div>
    <div class="gantt-date-axis-labels">${dateTickHtml}</div>
    ${todayMarkerHtml}
  </div>`;

  const rowIndexById = new Map();
  const chartGridLinesHtml = dateTicks.map((t) => `<div class="gantt-grid-line-vert" style="left:${t.pct}%"></div>`).join("");
  const html = [
    headerSpacer,
    headerDates,
    `<div class="gantt-chart-grid-lines" style="grid-column:2;grid-row:2/-1" aria-hidden="true">${chartGridLinesHtml}</div>`,
  ];
  let rowIdx = 0;
  rows.forEach((activity) => {
    const startDate =
      dateToMidnight(parseDateLocal(activity.plannedStartDate)) || new Date(startMs);
    const durationHours = Math.max(24, activity.plannedDurationHours || activity.baseEffortHours || 24);
    const endDate =
      dateToMidnight(parseDateLocal(activity.plannedEndDate)) ||
      new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);

    const barStart = Math.max(startDate.getTime(), startMs);
    const barEnd = Math.min(endDate.getTime(), endMs);
    let leftPct = 0;
    let widthPct = 4;
    const clampedStart = new Date(barStart);
    const clampedEnd = new Date(barEnd);

    if (barEnd <= startMs) {
      leftPct = 0;
      widthPct = 2;
    } else if (barStart >= endMs) {
      leftPct = 98;
      widthPct = 2;
    } else {
      leftPct = spanMs > 0 ? ((barStart - startMs) / spanMs) * 100 : 0;
      widthPct = spanMs > 0 ? Math.max(4, ((barEnd - barStart) / spanMs) * 100) : 4;
    }
    const progressPct = Math.max(0, Math.min(100, Number(activity.completionPercentage) || 0));
    const delayed = activity.delayHours > 0 || String(activity.activityStatus).toLowerCase() === "delayed";

    rowIndexById.set(activity.activityId, rowIdx);
    html.push(`
      <div class="gantt-label-cell" data-activity-id="${escapeHtml(activity.activityId)}" data-row="${rowIdx}">
        <div class="gantt-label-title">${escapeHtml(activity.activityId)} - ${escapeHtml(activity.activityName || "Unnamed")}</div>
        <div class="gantt-label-meta">
          ${escapeHtml(activity.phase || "-")} | ${escapeHtml(activity.activityStatus || "-")} | Delay ${Math.round(activity.delayHours)}h
        </div>
      </div>
      <div class="gantt-track" data-activity-id="${escapeHtml(activity.activityId)}" data-row="${rowIdx}" data-bar-left="${leftPct}" data-bar-width="${widthPct}">
        ${todayMarkerHtml}
        <div
          class="gantt-bar ${delayed ? "is-delayed" : ""} ${criticalSet.has(activity.activityId) ? "is-critical" : ""}"
          style="left:${leftPct}%; width:${widthPct}%"
          data-original-start="${clampedStart.toISOString().slice(0, 10)}"
          data-original-end="${clampedEnd.toISOString().slice(0, 10)}"
        >
          <div class="gantt-progress" style="width:${progressPct}%"></div>
          <span class="gantt-caption" title="${escapeHtml(activity.activityId)} - ${escapeHtml(activity.activityName || "")} | ${progressPct}% complete">${escapeHtml(activity.activityId)}</span>
          <div class="gantt-bar-resize-handle" title="Drag to resize"></div>
        </div>
      </div>
    `);
    rowIdx++;
  });

  dom.ganttGrid.innerHTML = html.join("");
  wireGanttBarDrag(rows, start, end, spanMs);
  renderDependencyLines(rows, rowIndexById);
  renderDependencyTable(rows);
}

function wireGanttBarDrag(rows, rangeStart, rangeEnd, spanMs) {
  const bars = dom.ganttGrid.querySelectorAll(".gantt-bar");
  const trackWidth = dom.ganttGrid.querySelector(".gantt-track")?.offsetWidth || 1;
  const numDays = Math.max(1, spanMs / MS_PER_DAY);
  const dayWidthPct = 100 / numDays;

  bars.forEach((bar) => {
    const trackEl = bar.closest(".gantt-track");
    const activityId = trackEl?.dataset?.activityId;
    if (!activityId) return;
    const activity = rows.find((a) => a.activityId === activityId);
    if (!activity) return;

    bar.style.cursor = "grab";
    bar.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("gantt-bar-resize-handle")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startLeft = parseFloat(bar.style.left) || 0;
      const startWidth = parseFloat(bar.style.width) || 10;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dxPct = (dx / trackWidth) * 100;
        let newLeft = Math.max(0, Math.min(100 - startWidth, startLeft + dxPct));
        newLeft = Math.round(newLeft / dayWidthPct) * dayWidthPct;
        newLeft = Math.max(0, Math.min(100 - startWidth, newLeft));
        bar.style.left = `${newLeft}%`;
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        bar.style.cursor = "grab";

        const newLeft = parseFloat(bar.style.left) || startLeft;
        const deltaPct = (newLeft - startLeft) / 100;
        const deltaMs = deltaPct * spanMs;

        const fallbackStart = dateToMidnight(rangeStart) || rangeStart;
        const oldStart =
          parseDateLocal(activity.plannedStartDate) ||
          parseDateLocal(activity.actualStartDate) ||
          fallbackStart;
        const oldEnd =
          parseDateLocal(activity.plannedEndDate) ||
          parseDateLocal(activity.actualEndDate) ||
          new Date(oldStart.getTime() + 24 * 60 * 60 * 1000);
        const durationMs = oldEnd.getTime() - oldStart.getTime();

        let newStart = new Date(oldStart.getTime() + deltaMs);
        newStart = dateToMidnight(newStart) || newStart;
        let newEnd = new Date(newStart.getTime() + durationMs);
        newEnd = dateToMidnight(newEnd) || newEnd;

        if (newStart.getTime() !== oldStart.getTime()) {
          updateActivity(activityId, {
            plannedStartDate: `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`,
            plannedEndDate: `${newEnd.getFullYear()}-${String(newEnd.getMonth() + 1).padStart(2, "0")}-${String(newEnd.getDate()).padStart(2, "0")}`,
          });
          loadProjectActivities({ resetView: false });
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      bar.style.cursor = "grabbing";
    });

    const resizeHandle = bar.querySelector(".gantt-bar-resize-handle");
    if (resizeHandle) {
      resizeHandle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startLeft = parseFloat(bar.style.left) || 0;
        const startWidth = parseFloat(bar.style.width) || 10;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dxPct = (dx / trackWidth) * 100;
          let newWidth = Math.max(2, Math.min(100 - startLeft, startWidth + dxPct));
          newWidth = Math.round(newWidth / dayWidthPct) * dayWidthPct;
          newWidth = Math.max(2, Math.min(100 - startLeft, newWidth));
          bar.style.width = `${newWidth}%`;
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);

          const newWidth = parseFloat(bar.style.width) || startWidth;
          const widthDeltaPct = (newWidth - startWidth) / 100;
          const deltaMs = widthDeltaPct * spanMs;

          const origStart =
            (bar.dataset.originalStart ? parseDateLocal(bar.dataset.originalStart) : null) ||
            parseDateLocal(activity.plannedStartDate) ||
            dateToMidnight(rangeStart) ||
            rangeStart;
          const origEnd =
            (bar.dataset.originalEnd ? parseDateLocal(bar.dataset.originalEnd) : null) ||
            parseDateLocal(activity.plannedEndDate) ||
            new Date(origStart.getTime() + 24 * 60 * 60 * 1000);
          let newEnd = new Date(origEnd.getTime() + deltaMs);
          newEnd = dateToMidnight(newEnd) || newEnd;

          if (newEnd.getTime() > (dateToMidnight(origStart) || origStart).getTime()) {
            updateActivity(activityId, {
              plannedEndDate: `${newEnd.getFullYear()}-${String(newEnd.getMonth() + 1).padStart(2, "0")}-${String(newEnd.getDate()).padStart(2, "0")}`,
            });
            loadProjectActivities({ resetView: false });
          }
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }
  });
}

function renderDependencyLines(rows, rowIndexById) {
  let svg = dom.ganttGrid.parentElement?.querySelector(".gantt-dependency-svg");
  if (svg) svg.remove();
  const container = dom.ganttGrid.parentElement;
  if (!container) return;

  const bars = dom.ganttGrid.querySelectorAll(".gantt-bar");
  const barById = new Map();
  bars.forEach((bar) => {
    const track = bar.closest(".gantt-track");
    if (track) barById.set(track.dataset.activityId, { bar, track });
  });

  const paths = [];
  rows.forEach((activity) => {
    const deps = parseDependencies(activity.dependencies);
    deps.forEach((depId) => {
      if (!rowIndexById.has(depId)) return;
      const fromInfo = barById.get(depId);
      const toInfo = barById.get(activity.activityId);
      if (!fromInfo || !toInfo) return;
      const fromBar = fromInfo.bar.getBoundingClientRect();
      const toBar = toInfo.bar.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      const x1 = fromBar.right - cRect.left;
      const y1 = fromBar.top - cRect.top + fromBar.height / 2;
      const x2 = toBar.left - cRect.left;
      const y2 = toBar.top - cRect.top + toBar.height / 2;
      const midX = (x1 + x2) / 2;
      paths.push(`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    });
  });

  if (paths.length) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.className = "gantt-dependency-svg";
    const w = Math.max(container.scrollWidth, container.clientWidth);
    const h = Math.max(container.scrollHeight, container.clientHeight);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:1";
    paths.forEach((d) => {
      const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathEl.setAttribute("d", d);
      pathEl.setAttribute("fill", "none");
      pathEl.setAttribute("stroke", "rgba(47, 143, 255, 0.5)");
      pathEl.setAttribute("stroke-width", "1.5");
      svg.appendChild(pathEl);
    });
    container.style.position = "relative";
    container.appendChild(svg);
  }
}

function renderDependencyTable(rows) {
  const dependencyRows = rows.filter((activity) => String(activity.dependencies || "").trim());
  if (!dependencyRows.length) {
    dom.dependencyBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No dependency relationships found.</div></td></tr>`;
    return;
  }

  dom.dependencyBody.innerHTML = dependencyRows
    .sort((left, right) => right.riskScore - left.riskScore)
    .map(
      (activity) => `
      <tr>
        <td><strong>${escapeHtml(activity.activityId)}</strong><br /><span class="small">${escapeHtml(activity.activityName || "-")}</span></td>
        <td>${escapeHtml(activity.dependencies)}</td>
        <td>${escapeHtml(activity.dependencyType || "FS")}</td>
        <td><span class="${statusClass(activity.activityStatus)}">${escapeHtml(activity.activityStatus || "-")}</span></td>
        <td>${formatHours(activity.delayHours)}</td>
        <td>${formatHours(activity.predictedDelayHours)}</td>
        <td><span class="${statusClass(activity.riskLevel)}">${escapeHtml(activity.riskLevel)} (${activity.riskScore})</span></td>
        <td>${renderDependencyHealth(activity)}</td>
      </tr>
    `,
    )
    .join("");
}

function renderDependencyHealth(activity) {
  const missing = dependencyHealth.missingByActivity[activity.activityId] ?? [];
  const hasCycle = dependencyHealth.cycleActivityIds.includes(activity.activityId);
  const signals = [];
  if (missing.length) {
    signals.push(`<span class="${statusClass("critical")}">Missing: ${escapeHtml(missing.join(", "))}</span>`);
  }
  if (hasCycle) {
    signals.push(`<span class="${statusClass("critical")}">Cycle detected</span>`);
  }
  if (!signals.length) {
    signals.push(`<span class="${statusClass("completed")}">Validated</span>`);
  }
  return signals.join("<br />");
}

function wireEvents() {
  dom.applyButton.addEventListener("click", renderGantt);
  dom.resetRangeButton.addEventListener("click", () => {
    dom.rangeStart.value = bounds.min.toISOString().slice(0, 10);
    dom.rangeEnd.value = bounds.max.toISOString().slice(0, 10);
    renderGantt();
  });
  dom.todayButton?.addEventListener("click", () => {
    const today = dateToMidnight(new Date());
    const days = 30;
    const start = new Date(today);
    start.setDate(start.getDate() - Math.floor(days / 2));
    const end = new Date(today);
    end.setDate(end.getDate() + Math.ceil(days / 2));
    dom.rangeStart.value = start.toISOString().slice(0, 10);
    dom.rangeEnd.value = end.toISOString().slice(0, 10);
    renderGantt();
    requestAnimationFrame(() => {
      const marker = dom.ganttGrid?.querySelector(".gantt-today-marker");
      if (marker && dom.ganttContainer) {
        const track = dom.ganttGrid?.querySelector(".gantt-track");
        const pct = parseFloat(marker.style.left) || 50;
        if (track) {
          const chartWidth = track.offsetWidth;
          const containerWidth = dom.ganttContainer.clientWidth;
          const labelWidth = 280;
          const targetScroll = Math.max(0, (pct / 100) * chartWidth + labelWidth - containerWidth / 2);
          dom.ganttContainer.scrollLeft = Math.min(targetScroll, dom.ganttContainer.scrollWidth - containerWidth);
        }
      }
    });
  });
}

function hasSelectOption(selectNode, value) {
  return Array.from(selectNode.options).some((option) => option.value === value);
}

function loadProjectActivities({ resetView = false } = {}) {
  const previousView = {
    phase: dom.phaseFilter.value,
    status: dom.statusFilter.value,
    rangeStart: dom.rangeStart.value,
    rangeEnd: dom.rangeEnd.value,
  };

  activities = enrichActivities(getActivities());
  dependencyHealth = getDependencyHealth(activities);
  bounds = getTimelineBounds(activities);
  populateFilters();

  if (resetView) {
    dom.phaseFilter.value = "";
    dom.statusFilter.value = "";
    dom.rangeStart.value = bounds.min.toISOString().slice(0, 10);
    dom.rangeEnd.value = bounds.max.toISOString().slice(0, 10);
    renderGantt();
    return;
  }

  dom.phaseFilter.value = hasSelectOption(dom.phaseFilter, previousView.phase) ? previousView.phase : "";
  dom.statusFilter.value = hasSelectOption(dom.statusFilter, previousView.status) ? previousView.status : "";

  const restoredStart = parseDate(previousView.rangeStart);
  const restoredEnd = parseDate(previousView.rangeEnd);
  dom.rangeStart.value = restoredStart ? previousView.rangeStart : bounds.min.toISOString().slice(0, 10);
  dom.rangeEnd.value = restoredEnd ? previousView.rangeEnd : bounds.max.toISOString().slice(0, 10);
  renderGantt();
}

async function initialize() {
  await stateReady();
  initShell();
  setActiveNavigation();
  const currentUser = initializeAccessShell();
  if (!currentUser) return;
  wireEvents();
  initializeProjectToolbar({ onProjectChange: () => loadProjectActivities({ resetView: true }) });
  const unsubscribe = subscribeToStateChanges(() => loadProjectActivities({ resetView: false }));
  window.addEventListener(
    "pagehide",
    () => {
      unsubscribe();
    },
    { once: true },
  );
  loadProjectActivities({ resetView: true });
}

initialize().catch((e) => console.error("[gantt] init error:", e));
