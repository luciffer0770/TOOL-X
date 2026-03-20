/**
 * Global search – cross-page search for activities.
 * Ctrl+Shift+K to focus. Mounted in top header (not sidebar) for contrast on dark nav.
 */
import { escapeHtml } from "./common.js";
import { getActivities } from "./storage.js";
import { COLUMN_SCHEMA } from "./schema.js";

const SEARCHABLE_KEYS = new Set([
  "activityId",
  "activityName",
  "phase",
  "subActivity",
  "requiredMaterials",
  "requiredTools",
  "resourceDepartment",
  "delayReason",
  "remarks",
]);

function searchActivities(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const activities = getActivities();
  return activities.filter((activity) => {
    const inSchema = COLUMN_SCHEMA.some((col) => {
      if (!SEARCHABLE_KEYS.has(col.key)) return false;
      const val = String(activity[col.key] ?? "").toLowerCase();
      return val.includes(q);
    });
    if (inSchema) return true;
    const comments = activity.comments || [];
    const inComments = comments.some((c) => String(c.text || "").toLowerCase().includes(q));
    return inComments;
  });
}

function buildSearchResultsHtml(results, query) {
  if (!results.length) {
    return '<div class="global-search-empty">No activities match your search.</div>';
  }
  return results
    .slice(0, 12)
    .map(
      (a) => `
    <a href="activities.html?search=${encodeURIComponent(query)}&highlight=${encodeURIComponent(a.activityId)}" class="global-search-item">
      <strong>${escapeHtml(a.activityId)}</strong> – ${escapeHtml(a.activityName || "-")}
      <span class="small">${escapeHtml(a.phase || "")}</span>
    </a>
  `,
    )
    .join("");
}

function mountHost() {
  const header = document.querySelector(".atlas-top-header") || document.querySelector(".top-bar");
  const meta = header?.querySelector(".header-meta");
  if (!header || !meta) return null;
  let host = header.querySelector(".header-global-search");
  if (!host) {
    host = document.createElement("div");
    host.className = "header-global-search";
    header.insertBefore(host, meta);
  }
  return host;
}

export function initGlobalSearch() {
  if (document.querySelector("#global-search-input")) return;

  const host = mountHost();
  const fallbackNav = document.querySelector(".nav");
  const parent = host || fallbackNav;
  if (!parent) return;

  const searchWrap = document.createElement("div");
  searchWrap.className = "global-search-wrap";
  searchWrap.innerHTML = `
    <input type="search" id="global-search-input" placeholder="Search activities (Ctrl+Shift+K)" class="global-search-input" autocomplete="off" />
    <div id="global-search-results" class="global-search-results" hidden></div>
  `;
  if (host) {
    host.appendChild(searchWrap);
  } else {
    fallbackNav.insertBefore(searchWrap, fallbackNav.firstChild);
  }

  const input = searchWrap.querySelector("#global-search-input");
  const resultsEl = searchWrap.querySelector("#global-search-results");

  let debounceTimer = null;
  const DEBOUNCE_MS = 150;

  function showResults(query) {
    const results = searchActivities(query);
    resultsEl.innerHTML = buildSearchResultsHtml(results, query);
    resultsEl.hidden = !query.trim();
  }

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => showResults(input.value), DEBOUNCE_MS);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim()) showResults(input.value);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      resultsEl.hidden = true;
    }, 200);
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "K") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
