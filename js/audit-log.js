/**
 * Full-page Audit Log — reads from existing localStorage audit trail (audit.js).
 * Does not change how events are recorded.
 */
import { initPage } from "./page-init.js";
import { getAuditLog } from "./audit.js";
import { getProjects } from "./storage.js";
import { escapeHtml, notify, setActiveNavigation } from "./common.js";

const ENTITY_RE = /\b(ACT|PRJ|DOC|RSK)-[A-Z0-9]+\b/i;

function getSeverity(action) {
  const lc = String(action || "").toLowerCase();
  if (/(delete|clear|archive|restore|override)/.test(lc)) return "critical";
  if (/(import|bulk|export|login_fail|fail)/.test(lc)) return "warning";
  return "info";
}

function inferEntityType(action) {
  const lc = String(action || "").toLowerCase();
  if (/activity/.test(lc)) return "activity";
  if (/project/.test(lc)) return "project";
  if (/document|upload/.test(lc)) return "document";
  if (/risk/.test(lc)) return "risk";
  if (/login|logout|user/.test(lc)) return "user";
  return "system";
}

function inferActionCategory(action) {
  const a = String(action || "").toLowerCase();
  if (a.includes("import") || a.includes("upsert")) return "import";
  if (a.includes("delete")) return "delete";
  if (a.includes("update")) return "update";
  if (a.includes("add activity")) return "create";
  if (a.includes("clear")) return "clear";
  if (a.includes("save activities")) return "save";
  if (a.includes("export")) return "export";
  if (a.includes("login")) return "login";
  if (a.includes("logout")) return "logout";
  if (a.includes("upload")) return "upload";
  return "system";
}

function extractEntityId(raw) {
  if (raw.activityId) return String(raw.activityId);
  const m = String(raw.action || "").match(ENTITY_RE);
  return m ? m[0].toUpperCase() : null;
}

function buildDetailsPayload(raw) {
  const { at: _a, action: _ac, ...rest } = raw;
  const keys = Object.keys(rest);
  if (!keys.length) return null;
  try {
    return JSON.stringify(rest, null, 2);
  } catch {
    return String(rest);
  }
}

function normalizeEntry(raw, idx) {
  const action = raw.action || "";
  const id = `${raw.at}|${action}|${raw.activityId ?? ""}|${idx}`;
  const entityId = extractEntityId(raw);
  const user = raw.user || raw.username || null;
  const project = raw.project || raw.projectName || null;
  return {
    id,
    at: raw.at,
    action,
    actionCategory: inferActionCategory(action),
    entityType: inferEntityType(action),
    entityId,
    user: user || "—",
    project: project || "—",
    severity: getSeverity(action),
    detailsText: buildDetailsPayload(raw),
    raw,
  };
}

function loadNormalized() {
  return getAuditLog().map((e, i) => normalizeEntry(e, i));
}

const state = {
  searchQuery: "",
  dateFrom: null,
  dateTo: null,
  datePreset: "30",
  filterAction: "all",
  filterEntity: "all",
  filterUser: "all",
  filterProject: "all",
  filterSeverity: "all",
  viewMode: "timeline",
  page: 1,
  pageSize: 25,
  expandedIds: new Set(),
  sortKey: "timestamp",
  sortDir: "desc",
  loading: false,
  allEntries: [],
};

function applyDatePreset() {
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (state.datePreset === "all") {
    state.dateFrom = null;
    state.dateTo = null;
    return;
  }
  if (state.datePreset === "today") {
    state.dateFrom = d0.toISOString().slice(0, 10);
    state.dateTo = state.dateFrom;
    return;
  }
  const days = Number(state.datePreset) || 30;
  const from = new Date(d0);
  from.setDate(from.getDate() - (days - 1));
  state.dateFrom = from.toISOString().slice(0, 10);
  state.dateTo = d0.toISOString().slice(0, 10);
}

function entryInDateRange(entry) {
  if (!state.dateFrom && !state.dateTo) return true;
  const t = new Date(entry.at).getTime();
  if (state.dateFrom) {
    const start = new Date(state.dateFrom);
    start.setHours(0, 0, 0, 0);
    if (t < start.getTime()) return false;
  }
  if (state.dateTo) {
    const end = new Date(state.dateTo);
    end.setHours(23, 59, 59, 999);
    if (t > end.getTime()) return false;
  }
  return true;
}

function matchesSearch(entry, q) {
  if (!q.trim()) return true;
  const s = q.trim().toLowerCase();
  const blob = [entry.action, entry.entityId, entry.user, entry.project, entry.detailsText || ""].join(" ").toLowerCase();
  return blob.includes(s);
}

function projectMatches(entry) {
  if (state.filterProject === "all") return true;
  const projects = getProjects();
  const p = projects.find((x) => x.id === state.filterProject);
  const name = p?.name || "";
  if (!entry.project || entry.project === "—") return true;
  return entry.project === name;
}

function passesFilters(entry) {
  if (state.filterAction !== "all" && entry.actionCategory !== state.filterAction) return false;
  if (state.filterEntity !== "all" && entry.entityType !== state.filterEntity) return false;
  if (state.filterUser !== "all") {
    const u = (entry.user || "").trim().toLowerCase();
    if (state.filterUser === "system") {
      if (u && u !== "—") return false;
    } else if (u !== state.filterUser) return false;
  }
  if (state.filterSeverity !== "all" && entry.severity !== state.filterSeverity) return false;
  if (!projectMatches(entry)) return false;
  return true;
}

function sortEntries(list) {
  const dir = state.sortDir === "asc" ? 1 : -1;
  const key = state.sortKey;
  return [...list].sort((a, b) => {
    let va;
    let vb;
    if (key === "timestamp") {
      va = new Date(a.at).getTime();
      vb = new Date(b.at).getTime();
    } else if (key === "action") {
      va = a.action.toLowerCase();
      vb = b.action.toLowerCase();
    } else if (key === "user") {
      va = a.user.toLowerCase();
      vb = b.user.toLowerCase();
    } else if (key === "severity") {
      const order = { critical: 0, warning: 1, info: 2 };
      va = order[a.severity] ?? 3;
      vb = order[b.severity] ?? 3;
    } else return 0;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
}

function getFiltered() {
  return state.allEntries.filter((e) => entryInDateRange(e) && passesFilters(e) && matchesSearch(e, state.searchQuery));
}

function totalPagesFor(list) {
  if (state.pageSize === "all") return 1;
  const n = Number(state.pageSize) || 25;
  return Math.max(1, Math.ceil(list.length / n));
}

function paginate(list) {
  const ps = state.pageSize;
  if (ps === "all") return { rows: list, total: list.length, totalPages: 1 };
  const n = Number(ps) || 25;
  const totalPages = totalPagesFor(list);
  const page = Math.min(state.page, totalPages);
  state.page = page;
  const start = (page - 1) * n;
  return { rows: list.slice(start, start + n), total: list.length, totalPages };
}

function kpiCounts(allEntries) {
  const total = allEntries.length;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const today = allEntries.filter((e) => new Date(e.at) >= dayStart).length;
  const warnings = allEntries.filter((e) => e.severity === "warning").length;
  const critical = allEntries.filter((e) => e.severity === "critical").length;
  return { total, today, warnings, critical };
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatDateLong(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatDateShort(iso) {
  return new Date(iso).toLocaleString();
}

function actionBadgeLabel(cat) {
  const map = {
    import: "Import/Upsert",
    update: "Update",
    delete: "Delete",
    create: "Create",
    clear: "Clear",
    save: "Save",
    export: "Export",
    login: "Login",
    logout: "Logout",
    upload: "Upload",
    system: "System",
  };
  return map[cat] || "Event";
}

function exportCsv(rows) {
  const cols = ["timestamp", "action", "entity_type", "entity_id", "user", "project", "severity", "details"];
  const lines = [cols.join(",")];
  for (const e of rows) {
    const det = (e.detailsText || "").replace(/"/g, '""');
    lines.push(
      [
        `"${e.at}"`,
        `"${String(e.action).replace(/"/g, '""')}"`,
        e.entityType,
        e.entityId ? `"${e.entityId}"` : "",
        `"${e.user}"`,
        `"${e.project}"`,
        e.severity,
        `"${det}"`,
      ].join(","),
    );
  }
  const blob = new Blob(["\ufeff", lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `atlas-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  notify("CSV exported.", "success");
}

function exportPdf(rows) {
  const from = state.dateFrom || "—";
  const to = state.dateTo || "—";
  const w = window.open("", "_blank");
  if (!w) {
    notify("Allow pop-ups to export PDF (print).", "warning");
    return;
  }
  const rowsHtml = rows
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.at)}</td><td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.entityId || "—")}</td><td>${escapeHtml(e.user)}</td><td>${escapeHtml(e.project)}</td><td>${escapeHtml(e.severity)}</td></tr>`,
    )
    .join("");
  w.document.write(`<!DOCTYPE html><html><head><title>ATLAS Audit Log</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:20px;margin:0 0 8px}
      .meta{color:#64748b;font-size:12px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}
      th{background:#f8fafc}
      @media print{body{padding:12px}}
    </style></head><body>
    <h1>ATLAS — Audit Log Report</h1>
    <div class="meta">Range: ${escapeHtml(from)} → ${escapeHtml(to)} · Generated ${escapeHtml(new Date().toISOString())} · ${rows.length} events</div>
    <table><thead><tr><th>Timestamp</th><th>Action</th><th>Entity ID</th><th>User</th><th>Project</th><th>Severity</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
  w.document.close();
}

function openDetailModal(entry) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay audit-detail-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="modal-dialog audit-detail-dialog">
      <button type="button" class="audit-detail-close ghost" aria-label="Close">&times;</button>
      <h2 class="modal-title audit-detail-title"><span class="audit-detail-title-icon" aria-hidden="true">&#8987;</span> Event detail</h2>
      <div class="audit-detail-body">
        <p><span class="audit-detail-k">Action</span><span class="audit-action-badge audit-action-badge--${escapeHtml(entry.actionCategory)}">${escapeHtml(actionBadgeLabel(entry.actionCategory))}</span></p>
        <p><span class="audit-detail-k">Description</span><span>${escapeHtml(entry.action)}</span></p>
        <p><span class="audit-detail-k">Timestamp</span><span class="font-mono">${escapeHtml(entry.at)}</span></p>
        <p><span class="audit-detail-k">Entity</span><span>${escapeHtml(entry.entityType)} ${entry.entityId ? `<code>${escapeHtml(entry.entityId)}</code>` : "—"}</span></p>
        <p><span class="audit-detail-k">User</span><span>${escapeHtml(entry.user)}</span></p>
        <p><span class="audit-detail-k">Project</span><span>${escapeHtml(entry.project)}</span></p>
        <p><span class="audit-detail-k">Severity</span><span class="audit-severity-pill audit-severity-pill--${escapeHtml(entry.severity)}">${escapeHtml(entry.severity)}</span></p>
        ${entry.detailsText ? `<div class="audit-detail-raw"><span class="audit-detail-k">Raw details</span><pre class="audit-pre">${escapeHtml(entry.detailsText)}</pre></div>` : ""}
      </div>
      <div class="modal-actions audit-detail-footer">
        <button type="button" class="ghost audit-copy-entry">Copy to clipboard</button>
        <button type="button" class="ghost audit-detail-close-btn">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll(".audit-detail-close, .audit-detail-close-btn").forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector(".audit-copy-entry")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry.raw, null, 2));
      notify("Copied.", "success");
    } catch {
      notify("Copy failed.", "error");
    }
  });
}

function groupByDate(rows) {
  const map = new Map();
  for (const e of rows) {
    const key = new Date(e.at).toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function renderTimeline(groups) {
  return groups
    .map(([dateKey, items]) => {
      const sample = items[0];
      const longDate = formatDateLong(sample.at);
      return `
      <div class="audit-timeline-group">
        <div class="audit-timeline-date-header">
          <span class="audit-cal-ico" aria-hidden="true">&#128197;</span>
          <span class="audit-timeline-date-title">${escapeHtml(longDate)}</span>
          <span class="audit-timeline-date-count">(${items.length} events)</span>
        </div>
        <div class="audit-timeline-rows">
          ${items.map((e) => renderTimelineRow(e)).join("")}
        </div>
      </div>`;
    })
    .join("");
}

function renderTimelineRow(e) {
  const expanded = state.expandedIds.has(e.id);
  const chev = expanded ? "&#9650;" : "&#9660;";
  return `
    <div class="audit-timeline-row-wrap">
      <button type="button" class="audit-timeline-row ${expanded ? "is-expanded" : ""}" data-expand="${escapeHtml(e.id)}" aria-expanded="${expanded}">
        <div class="audit-tl-time font-mono">${escapeHtml(formatTime(e.at))}</div>
        <div class="audit-tl-node audit-severity-node audit-severity-node--${escapeHtml(e.severity)}" aria-hidden="true"><span></span></div>
        <div class="audit-tl-body">
          <div class="audit-tl-line1">
            <span class="audit-action-badge audit-action-badge--${escapeHtml(e.actionCategory)}">${escapeHtml(actionBadgeLabel(e.actionCategory))}</span>
            ${e.entityId ? `<span class="audit-entity-tag font-mono">${escapeHtml(e.entityId)}</span>` : ""}
            <span class="audit-tl-action-text">${escapeHtml(e.action)}</span>
          </div>
          <div class="audit-tl-line2">
            <span>&#128100; <span class="font-mono">${escapeHtml(e.user)}</span></span>
            <span class="audit-dot-sep"></span>
            <span>&#128193; ${escapeHtml(e.project)}</span>
            ${e.detailsText ? `<span class="audit-dot-sep"></span><span class="audit-view-details-hint">View details</span>` : ""}
          </div>
        </div>
        <span class="audit-tl-chev" aria-hidden="true">${chev}</span>
      </button>
      ${expanded && e.detailsText ? `<div class="audit-timeline-expand"><div class="audit-expand-grid"><div><div class="audit-expand-label">Event details</div><pre class="audit-pre">${escapeHtml(e.detailsText)}</pre></div><div><div class="audit-expand-label">Context</div><ul class="audit-context-list"><li>ISO: ${escapeHtml(e.at)}</li><li>Project: ${escapeHtml(e.project)}</li><li>Entity: ${escapeHtml(e.entityType)} ${e.entityId ? escapeHtml(e.entityId) : "—"}</li></ul></div></div></div>` : ""}
    </div>`;
}

function renderTable(rows) {
  const sortHint = (key) => {
    const active = state.sortKey === key;
    return `<span class="audit-sort-ico ${active ? "is-active" : ""}" data-sort="${key}" title="Sort">&#8597;</span>`;
  };
  return `
  <div class="table-wrap audit-table-wrap">
    <table class="audit-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Timestamp ${sortHint("timestamp")}</th>
          <th>Action ${sortHint("action")}</th>
          <th>Entity ID</th>
          <th>Details</th>
          <th>User ${sortHint("user")}</th>
          <th>Project</th>
          <th>Severity ${sortHint("severity")}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (e, i) => `
          <tr>
            <td>${i + 1 + (state.pageSize === "all" ? 0 : (state.page - 1) * (Number(state.pageSize) || 25))}</td>
            <td class="font-mono" title="${escapeHtml(relativeHint(e.at))}">${escapeHtml(formatDateShort(e.at))}</td>
            <td><span class="audit-action-badge audit-action-badge--${escapeHtml(e.actionCategory)}">${escapeHtml(actionBadgeLabel(e.actionCategory))}</span></td>
            <td>${e.entityId ? `<span class="audit-entity-tag font-mono">${escapeHtml(e.entityId)}</span>` : '<span class="audit-muted-dash">—</span>'}</td>
            <td class="audit-details-cell"><span title="${escapeHtml((e.detailsText || e.action).slice(0, 500))}">${escapeHtml(truncate(e.detailsText || e.action, 48))}</span></td>
            <td>${escapeHtml(e.user)}</td>
            <td>${escapeHtml(e.project)}</td>
            <td><span class="audit-severity-pill audit-severity-pill--${escapeHtml(e.severity)}">${escapeHtml(e.severity)}</span></td>
            <td class="audit-row-actions">
              <button type="button" class="ghost audit-icon-btn" data-detail="${escapeHtml(e.id)}" title="View details">&#128065;</button>
              <button type="button" class="ghost audit-icon-btn" data-copy="${escapeHtml(e.id)}" title="Copy log entry">&#128203;</button>
            </td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}

function relativeHint(iso) {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 48) return `${h} hours ago`;
    return d.toISOString();
  } catch {
    return "";
  }
}

function truncate(s, n) {
  if (!s) return "—";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function buildPageList(current, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out = [];
  const near = new Set([1, totalPages, current, current - 1, current + 1, current - 2, current + 2].filter((p) => p >= 1 && p <= totalPages));
  const sorted = [...near].sort((a, b) => a - b);
  let prev = 0;
  for (const p of sorted) {
    if (p > prev + 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function renderPagination(total, totalPages) {
  const ps = state.pageSize;
  const n = ps === "all" ? total : Number(ps) || 25;
  const start = total === 0 ? 0 : ps === "all" ? 1 : (state.page - 1) * n + 1;
  const end = total === 0 ? 0 : ps === "all" ? total : Math.min(state.page * n, total);
  const pages = buildPageList(state.page, totalPages);
  const pageBtns = pages
    .map((p) =>
      p === "…"
        ? `<span class="audit-page-ellipsis">…</span>`
        : `<button type="button" class="ghost audit-page-btn ${p === state.page ? "is-current" : ""}" data-page="${p}">${p}</button>`,
    )
    .join("");
  return `
  <div class="audit-pagination">
    <button type="button" class="ghost audit-page-nav" data-page-prev ${state.page <= 1 ? "disabled" : ""}>&#8592; Previous</button>
    <div class="audit-page-btns">${pageBtns}</div>
    <button type="button" class="ghost audit-page-nav" data-page-next ${state.page >= totalPages ? "disabled" : ""}>Next &#8594;</button>
    <span class="audit-page-summary">Showing ${start}–${end} of ${total} events</span>
  </div>`;
}

function activeFilterChips() {
  const chips = [];
  if (state.searchQuery.trim()) chips.push({ key: "search", label: `Search: ${state.searchQuery.slice(0, 24)}` });
  if (state.filterAction !== "all") chips.push({ key: "filterAction", label: `Action: ${state.filterAction}` });
  if (state.filterEntity !== "all") chips.push({ key: "filterEntity", label: `Entity: ${state.filterEntity}` });
  if (state.filterUser !== "all") chips.push({ key: "filterUser", label: `User: ${state.filterUser}` });
  if (state.filterProject !== "all") chips.push({ key: "filterProject", label: "Project filter" });
  if (state.filterSeverity !== "all") chips.push({ key: "filterSeverity", label: `Severity: ${state.filterSeverity}` });
  if (state.datePreset !== "all") chips.push({ key: "datePreset", label: `Range: ${state.datePreset === "today" ? "Today" : `${state.datePreset}d`}` });
  return chips;
}

function renderKpis(filteredAll) {
  const k = kpiCounts(filteredAll);
  const critClass = k.critical > 0 ? " audit-kpi--pulse" : "";
  return `
  <div class="audit-kpi-grid">
    <div class="audit-kpi-card">
      <div class="audit-kpi-icon audit-kpi-icon--blue">&#9889;</div>
      <div><div class="audit-kpi-value">${k.total}</div><div class="audit-kpi-label">Total events</div><div class="audit-kpi-sub">All time (loaded)</div></div>
    </div>
    <div class="audit-kpi-card">
      <div class="audit-kpi-icon audit-kpi-icon--violet">&#128197;</div>
      <div><div class="audit-kpi-value">${k.today}</div><div class="audit-kpi-label">Today</div><div class="audit-kpi-sub">Since midnight</div></div>
    </div>
    <div class="audit-kpi-card">
      <div class="audit-kpi-icon audit-kpi-icon--amber">&#9888;</div>
      <div><div class="audit-kpi-value">${k.warnings}</div><div class="audit-kpi-label">Warnings</div><div class="audit-kpi-sub">In current view</div></div>
    </div>
    <div class="audit-kpi-card${critClass}">
      <div class="audit-kpi-icon audit-kpi-icon--red">&#128737;</div>
      <div><div class="audit-kpi-value">${k.critical}</div><div class="audit-kpi-label">Critical</div><div class="audit-kpi-sub">High-impact actions</div></div>
    </div>
  </div>`;
}

function renderApp() {
  const root = document.getElementById("audit-log-app");
  if (!root) return;

  const filteredAll = getFiltered();
  const sorted = state.viewMode === "table" ? sortEntries(filteredAll) : sortEntries(filteredAll);
  const { rows, total, totalPages } = paginate(sorted);

  const projects = getProjects();
  const projectOpts = projects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");

  const chips = activeFilterChips();
  const chipsHtml =
    chips.length === 0
      ? ""
      : `<div class="audit-filter-chips">${chips.map((c) => `<span class="audit-chip">${escapeHtml(c.label)}<button type="button" class="audit-chip-x" data-chip="${escapeHtml(c.key)}">&times;</button></span>`).join("")}<button type="button" class="audit-clear-filters ghost" data-clear-filters>Clear all filters</button></div>`;

  const mainContent =
    state.loading
      ? `<div class="audit-skeleton-list">${Array.from({ length: 8 }, () => '<div class="audit-skeleton-row"><div class="skeleton" style="width:72px;height:14px"></div><div class="skeleton" style="width:28px;height:28px;border-radius:50%"></div><div class="skeleton" style="flex:1;height:36px"></div></div>').join("")}</div>`
      : total === 0 && state.allEntries.length === 0
        ? `<div class="audit-empty"><div class="audit-empty-ico">&#8987;</div><p>No audit events recorded yet</p><p class="audit-empty-hint">Actions taken on this platform will appear here.</p></div>`
        : total === 0
          ? `<div class="audit-empty"><div class="audit-empty-ico">&#128269;</div><p>No events match your filters</p><p class="audit-empty-hint">Try adjusting your search or date range.</p><button type="button" class="ghost" data-clear-filters>Clear all filters</button></div>`
          : state.viewMode === "timeline"
            ? renderTimeline(groupByDate(rows))
            : renderTable(rows);

  root.innerHTML = `
    <div class="audit-page-header">
      <div class="audit-page-header-left">
        <div class="audit-breadcrumb"><a href="project-setup.html">Settings</a><span class="audit-bc-sep">/</span><span>Audit Log</span></div>
        <div class="audit-page-title-row">
          <span class="audit-page-title-ico" aria-hidden="true">&#8987;</span>
          <h1 class="audit-page-title">Audit Log</h1>
        </div>
        <p class="audit-page-sub">Complete tamper-evident trail of platform actions recorded in this browser. Data is stored locally with your session.</p>
      </div>
      <div class="audit-page-header-actions">
        <button type="button" class="ghost audit-header-btn" id="audit-export-csv">&#8595; Export CSV</button>
        <button type="button" class="ghost audit-header-btn" id="audit-export-pdf">&#128196; Export PDF</button>
        <button type="button" class="ghost audit-header-btn audit-icon-only" id="audit-refresh" title="Refresh audit log">&#8635;</button>
      </div>
    </div>
    ${renderKpis(state.allEntries)}
    <section class="audit-filters-card">
      <div class="audit-filters-row1">
        <div class="audit-search-wrap">
          <span class="audit-search-ico" aria-hidden="true">&#128269;</span>
          <input type="search" class="audit-search-input" id="audit-search" placeholder="Search by action, user, activity ID, project…" value="${escapeHtml(state.searchQuery)}" autocomplete="off" />
          ${state.searchQuery ? `<button type="button" class="audit-search-clear" id="audit-search-clear" aria-label="Clear search">&times;</button>` : ""}
        </div>
        <div class="audit-date-range">
          <label class="audit-date-label">From</label>
          <input type="date" class="audit-date-input" id="audit-date-from" value="${state.dateFrom || ""}" />
          <label class="audit-date-label">To</label>
          <input type="date" class="audit-date-input" id="audit-date-to" value="${state.dateTo || ""}" />
        </div>
        <div class="audit-preset-pills">
          ${["today", "7", "30", "all"].map((p) => {
            const labels = { today: "Today", 7: "7 days", 30: "30 days", all: "All time" };
            const active = state.datePreset === p;
            return `<button type="button" class="audit-preset ${active ? "is-active" : ""}" data-preset="${p}">${labels[p]}</button>`;
          }).join("")}
        </div>
      </div>
      <div class="audit-filters-row2">
        <span class="audit-filters-label"><span aria-hidden="true">&#9881;</span> Filters</span>
        <select class="audit-filter-select" id="audit-filter-action">
          <option value="all">All actions</option>
          <option value="import">Import / upsert</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="create">Create</option>
          <option value="save">Save</option>
          <option value="clear">Clear</option>
          <option value="export">Export</option>
          <option value="login">Login</option>
          <option value="logout">Logout</option>
          <option value="upload">Upload</option>
          <option value="system">System</option>
        </select>
        <select class="audit-filter-select" id="audit-filter-entity">
          <option value="all">All entities</option>
          <option value="activity">Activity</option>
          <option value="project">Project</option>
          <option value="document">Document</option>
          <option value="risk">Risk</option>
          <option value="user">User</option>
          <option value="system">System</option>
        </select>
        <select class="audit-filter-select" id="audit-filter-user">
          <option value="all">All users</option>
          <option value="planner">planner</option>
          <option value="management">management</option>
          <option value="technician">technician</option>
          <option value="system">system / unknown</option>
        </select>
        <select class="audit-filter-select" id="audit-filter-project">
          <option value="all">All projects</option>
          ${projectOpts}
        </select>
        <select class="audit-filter-select" id="audit-filter-severity">
          <option value="all">All severity</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      ${chipsHtml}
    </section>
    <section class="audit-log-card">
      <div class="audit-log-card-head">
        <div class="audit-log-card-head-left">
          <span class="audit-log-card-title">${state.viewMode === "timeline" ? "Activity timeline" : "Event table"}</span>
          <span class="audit-count-badge">${total} events</span>
        </div>
        <div class="audit-log-card-head-right">
          <div class="audit-view-toggle">
            <button type="button" class="audit-preset ${state.viewMode === "timeline" ? "is-active" : ""}" data-view="timeline">Timeline</button>
            <button type="button" class="audit-preset ${state.viewMode === "table" ? "is-active" : ""}" data-view="table">Table</button>
          </div>
          <select class="audit-page-size-select" id="audit-page-size">
            <option value="25" ${state.pageSize === 25 ? "selected" : ""}>25 per page</option>
            <option value="50" ${state.pageSize === 50 ? "selected" : ""}>50 per page</option>
            <option value="100" ${state.pageSize === 100 ? "selected" : ""}>100 per page</option>
            <option value="all" ${state.pageSize === "all" ? "selected" : ""}>All</option>
          </select>
        </div>
      </div>
      <div class="audit-log-card-body">${mainContent}</div>
    </section>
    ${!state.loading && total > 0 ? renderPagination(total, totalPages) : ""}
  `;

  syncFormControls();
  bindHandlers(sorted);
}

function syncFormControls() {
  const fa = document.getElementById("audit-filter-action");
  const fe = document.getElementById("audit-filter-entity");
  const fu = document.getElementById("audit-filter-user");
  const fp = document.getElementById("audit-filter-project");
  const fs = document.getElementById("audit-filter-severity");
  if (fa) fa.value = state.filterAction;
  if (fe) fe.value = state.filterEntity;
  if (fu) fu.value = state.filterUser;
  if (fp) fp.value = state.filterProject;
  if (fs) fs.value = state.filterSeverity;
}

function bindHandlers(sortedFull) {
  document.getElementById("audit-export-csv")?.addEventListener("click", () => exportCsv(sortedFull));
  document.getElementById("audit-export-pdf")?.addEventListener("click", () => exportPdf(sortedFull));

  document.getElementById("audit-refresh")?.addEventListener("click", () => {
    state.loading = true;
    renderApp();
    requestAnimationFrame(() => {
      state.allEntries = loadNormalized();
      state.loading = false;
      state.page = 1;
      renderApp();
      notify("Audit log refreshed.", "success");
    });
  });

  document.getElementById("audit-search")?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    state.page = 1;
    renderApp();
  });
  document.getElementById("audit-search-clear")?.addEventListener("click", () => {
    state.searchQuery = "";
    state.page = 1;
    renderApp();
  });

  document.getElementById("audit-date-from")?.addEventListener("change", (e) => {
    state.dateFrom = e.target.value || null;
    state.datePreset = "custom";
    state.page = 1;
    renderApp();
  });
  document.getElementById("audit-date-to")?.addEventListener("change", (e) => {
    state.dateTo = e.target.value || null;
    state.datePreset = "custom";
    state.page = 1;
    renderApp();
  });

  document.querySelectorAll(".audit-preset[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.datePreset = btn.getAttribute("data-preset");
      applyDatePreset();
      state.page = 1;
      renderApp();
    });
  });

  const onFilter = () => {
    state.page = 1;
    renderApp();
  };
  document.getElementById("audit-filter-action")?.addEventListener("change", (e) => {
    state.filterAction = e.target.value;
    onFilter();
  });
  document.getElementById("audit-filter-entity")?.addEventListener("change", (e) => {
    state.filterEntity = e.target.value;
    onFilter();
  });
  document.getElementById("audit-filter-user")?.addEventListener("change", (e) => {
    state.filterUser = e.target.value;
    onFilter();
  });
  document.getElementById("audit-filter-project")?.addEventListener("change", (e) => {
    state.filterProject = e.target.value;
    onFilter();
  });
  document.getElementById("audit-filter-severity")?.addEventListener("change", (e) => {
    state.filterSeverity = e.target.value;
    onFilter();
  });

  document.getElementById("audit-page-size")?.addEventListener("change", (e) => {
    const v = e.target.value;
    state.pageSize = v === "all" ? "all" : Number(v);
    state.page = 1;
    renderApp();
  });

  document.querySelectorAll("[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      state.viewMode = b.getAttribute("data-view");
      state.page = 1;
      renderApp();
    });
  });

  document.querySelectorAll(".audit-timeline-row[data-expand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-expand");
      if (state.expandedIds.has(id)) state.expandedIds.delete(id);
      else state.expandedIds.add(id);
      renderApp();
    });
  });

  document.querySelectorAll(".audit-sort-ico[data-sort]").forEach((el) => {
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const key = el.getAttribute("data-sort");
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = key === "timestamp" ? "desc" : "asc";
      }
      renderApp();
    });
  });

  document.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-detail");
      const e = sortedFull.find((x) => x.id === id);
      if (e) openDetailModal(e);
    });
  });
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-copy");
      const e = sortedFull.find((x) => x.id === id);
      if (!e) return;
      try {
        await navigator.clipboard.writeText(JSON.stringify(e.raw, null, 2));
        notify("Copied.", "success");
      } catch {
        notify("Copy failed.", "error");
      }
    });
  });

  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.page = Number(btn.getAttribute("data-page"));
      renderApp();
    });
  });
  document.querySelector("[data-page-prev]")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      renderApp();
    }
  });
  document.querySelector("[data-page-next]")?.addEventListener("click", () => {
    const sorted = sortEntries(getFiltered());
    const tp = totalPagesFor(sorted);
    if (state.page < tp) {
      state.page++;
      renderApp();
    }
  });

  document.querySelectorAll("[data-chip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-chip");
      if (key === "search") state.searchQuery = "";
      if (key === "filterAction") state.filterAction = "all";
      if (key === "filterEntity") state.filterEntity = "all";
      if (key === "filterUser") state.filterUser = "all";
      if (key === "filterProject") state.filterProject = "all";
      if (key === "filterSeverity") state.filterSeverity = "all";
      if (key === "datePreset") {
        state.datePreset = "all";
        state.dateFrom = null;
        state.dateTo = null;
      }
      state.page = 1;
      renderApp();
    });
  });
  document.querySelectorAll("[data-clear-filters]").forEach((b) => {
    b.addEventListener("click", () => {
      state.searchQuery = "";
      state.filterAction = "all";
      state.filterEntity = "all";
      state.filterUser = "all";
      state.filterProject = "all";
      state.filterSeverity = "all";
      state.datePreset = "all";
      state.dateFrom = null;
      state.dateTo = null;
      state.page = 1;
      renderApp();
    });
  });
}

function refreshEntries() {
  state.allEntries = loadNormalized();
  renderApp();
}

initPage({
  requireAuth: true,
  onReady() {
    setActiveNavigation();
    applyDatePreset();
    state.allEntries = loadNormalized();
    renderApp();
    window.addEventListener("industrial_planning_state_changed", refreshEntries);
    window.addEventListener("storage", (e) => {
      if (e.key === "atlas_planning_audit_v1") refreshEntries();
    });
    window.addEventListener("focus", refreshEntries);
  },
});
