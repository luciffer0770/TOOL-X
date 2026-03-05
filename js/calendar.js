/** Calendar view - activities by planned dates */
import { escapeHtml, setActiveNavigation } from "./common.js";
import { getActivities } from "./storage.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let viewDate = new Date();
let viewMode = "month";

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
  const last = new Date(year, month + 1, 0);
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

  let html = '<div class="calendar-header">' + DAYS.map((d) => `<div class="cal-day-name">${d}</div>`).join("") + "</div>";
  html += '<div class="calendar-body">';

  for (let week = 0; week < 6; week++) {
    for (let day = 0; day < 7; day++) {
      const d = new Date(start);
      d.setDate(start.getDate() + week * 7 + day);
      const key = d.toISOString().slice(0, 10);
      const isCurrentMonth = d.getMonth() === month;
      const isToday = key === new Date().toISOString().slice(0, 10);
      const dayActivities = byDate.get(key) || [];
      const cls = ["cal-day", isCurrentMonth ? "cal-current-month" : "cal-other-month", isToday ? "cal-today" : ""].filter(Boolean).join(" ");
      html += `<div class="${cls}">
        <div class="cal-day-num">${d.getDate()}</div>
        <div class="cal-day-events">${dayActivities.slice(0, 3).map((a) => `<a href="activities.html?search=${escapeHtml(a.activityId)}" class="cal-event" title="${escapeHtml(a.activityName)}">${escapeHtml(a.activityId)}</a>`).join("")}
        ${dayActivities.length > 3 ? `<span class="cal-more">+${dayActivities.length - 3}</span>` : ""}
        </div>
      </div>`;
    }
  }
  html += "</div>";
  return { html, title: `${MONTHS[month]} ${year}` };
}

function render() {
  const grid = document.getElementById("calendar-grid");
  const titleEl = document.querySelector(".panel-header h2");
  if (!grid) return;
  const result = viewMode === "month" ? renderMonth(viewDate) : renderMonth(viewDate);
  grid.innerHTML = result.html;
  if (titleEl) titleEl.textContent = `Calendar – ${result.title}`;
}

async function initialize() {
  await stateReady();
  const user = initializeAccessShell({});
  if (!user) return;
  initShell();
  initializeProjectToolbar({ onProjectChange: render, onStateChange: render });
  setActiveNavigation();

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

  render();
}
initialize().catch((e) => console.error("[calendar] init:", e));
