/**
 * Global search – cross-page search for activities.
 * Ctrl+Shift+K to open. Searches activityId, activityName, phase, materials, etc.
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
  return activities.filter((activity) =>
    COLUMN_SCHEMA.some((col) => {
      if (!SEARCHABLE_KEYS.has(col.key)) return false;
      const val = String(activity[col.key] ?? "").toLowerCase();
      return val.includes(q);
    }),
  );
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

export function initGlobalSearch() {
  const nav = document.querySelector(".nav");
  if (!nav) return;
  if (document.querySelector("#global-search-input")) return;

  const searchWrap = document.createElement("div");
  searchWrap.className = "global-search-wrap";
  searchWrap.innerHTML = `
    <input type="search" id="global-search-input" placeholder="Search activities (Ctrl+Shift+K)" class="global-search-input" autocomplete="off" />
    <div id="global-search-results" class="global-search-results" hidden></div>
  `;
  nav.insertBefore(searchWrap, nav.firstChild);

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
