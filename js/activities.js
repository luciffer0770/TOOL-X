import {
  ACTIVITY_STATUSES,
  COLUMN_SCHEMA,
  IMPORT_REQUIRED_KEYS,
  IMPORT_REQUIRED_LABELS,
  MATERIAL_STATUSES,
  OWNERSHIP_TYPES,
  PRIORITY_LEVELS,
  RISK_LEVELS,
  createEmptyActivity,
  createSampleDataset,
  getColumnByHeader,
  mapRowToActivity,
} from "./schema.js";
import { debounce, notify, setActiveNavigation, toCsv, triggerDownload } from "./common.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import {
  addActivity,
  clearAllActivities,
  deleteActivity,
  getActiveProject,
  getActivities,
  getColumnVisibility,
  getDefaultEditor,
  insertActivityAt,
  saveActivities,
  saveColumnVisibility,
  setDefaultEditor,
  updateActivity,
  upsertActivities,
} from "./storage.js";

const longTextFields = new Set(["requiredMaterials", "requiredTools", "remarks", "delayReason", "overrideReason"]);
const selectMap = {
  activityStatus: ACTIVITY_STATUSES,
  priority: PRIORITY_LEVELS,
  riskLevel: RISK_LEVELS,
  materialStatus: MATERIAL_STATUSES,
  materialOwnership: OWNERSHIP_TYPES,
};

const dom = {
  addButton: document.querySelector("#add-activity-btn"),
  addEmptyButton: document.querySelector("#add-empty-btn"),
  loadSampleButton: document.querySelector("#load-sample-btn"),
  importButton: document.querySelector("#import-btn"),
  excelInput: document.querySelector("#excel-input"),
  mergeStrategy: document.querySelector("#merge-strategy"),
  exportCsvButton: document.querySelector("#export-csv-btn"),
  exportJsonButton: document.querySelector("#export-json-btn"),
  clearButton: document.querySelector("#clear-btn"),
  tableHead: document.querySelector("#activities-head"),
  tableBody: document.querySelector("#activities-body"),
  tableWrap: document.querySelector("#activities-table-wrap"),
  floatingXScroll: document.querySelector("#activities-floating-scroll"),
  floatingXTrack: document.querySelector("#activities-floating-scroll-track"),
  columnChipGroup: document.querySelector("#column-chip-group"),
  columnDropdownToggle: document.querySelector("#column-dropdown-toggle"),
  columnDropdownPanel: document.querySelector("#column-dropdown-panel"),
  columnVisibilitySummary: document.querySelector("#column-visibility-summary"),
  columnSearchInput: document.querySelector("#column-search-input"),
  columnSelectAllButton: document.querySelector("#column-select-all-btn"),
  columnSelectCoreButton: document.querySelector("#column-select-core-btn"),
  columnSelectNoneButton: document.querySelector("#column-select-none-btn"),
  mandatoryHint: document.querySelector("#mandatory-columns-hint"),
  searchInput: document.querySelector("#search-input"),
  statusFilter: document.querySelector("#status-filter"),
  phaseFilter: document.querySelector("#phase-filter"),
  stats: document.querySelector("#activity-grid-stats"),
  defaultEditorInput: document.querySelector("#default-editor"),
};

let viewState = {
  activities: [],
  visibility: getColumnVisibility(),
  search: "",
  status: "",
  phase: "",
};

const uiState = {
  columnPanelOpen: false,
  columnPanelDropUp: false,
  columnPanelCloseTimer: null,
  syncingTableScroll: false,
  syncingFloatingScroll: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getInputValue(id) {
  const node = document.querySelector(`#${id}`);
  return node ? node.value : "";
}

function buildManualActivityDraft() {
  return {
    activityId: getInputValue("activityId"),
    phase: getInputValue("phase"),
    activityName: getInputValue("activityName"),
    subActivity: getInputValue("subActivity"),
    plannedStartDate: getInputValue("plannedStartDate"),
    plannedEndDate: getInputValue("plannedEndDate"),
    baseEffortHours: Number(getInputValue("baseEffortHours")) || 0,
    assignedManpower: Number(getInputValue("assignedManpower")) || 0,
    resourceDepartment: getInputValue("resourceDepartment"),
    materialOwnership: getInputValue("materialOwnership"),
    materialStatus: getInputValue("materialStatus"),
    priority: getInputValue("priority"),
    remarks: getInputValue("remarks"),
    lastModifiedBy: dom.defaultEditorInput.value || "Planner",
    lastModifiedDate: new Date().toISOString().slice(0, 10),
  };
}

function clearManualEntryForm() {
  [
    "activityId",
    "phase",
    "activityName",
    "subActivity",
    "plannedStartDate",
    "plannedEndDate",
    "baseEffortHours",
    "assignedManpower",
    "resourceDepartment",
    "remarks",
  ].forEach((id) => {
    const input = document.querySelector(`#${id}`);
    if (input) input.value = "";
  });
}

function getVisibleColumns() {
  return COLUMN_SCHEMA.filter((column) => viewState.visibility[column.key] !== false);
}

function buildControl(column, row) {
  const value = row[column.key] ?? "";
  if (selectMap[column.key]) {
    const options = [...new Set([...(selectMap[column.key] || []), value].filter(Boolean))];
    return `
      <select data-field="${column.key}">
        ${options
          .map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`)
          .join("")}
      </select>
    `;
  }
  if (column.type === "date") {
    return `<input data-field="${column.key}" type="date" value="${escapeHtml(value)}" />`;
  }
  if (column.type === "number") {
    return `<input data-field="${column.key}" type="number" step="0.1" value="${escapeHtml(value)}" />`;
  }
  if (longTextFields.has(column.key)) {
    return `<textarea data-field="${column.key}">${escapeHtml(value)}</textarea>`;
  }
  return `<input data-field="${column.key}" type="text" value="${escapeHtml(value)}" />`;
}

function populateFilterOptions() {
  const statuses = new Set(ACTIVITY_STATUSES);
  const phases = new Set();

  viewState.activities.forEach((activity) => {
    if (activity.activityStatus) statuses.add(activity.activityStatus);
    if (activity.phase) phases.add(activity.phase);
  });

  const statusOptions = ['<option value="">All</option>']
    .concat(
      [...statuses]
        .sort((left, right) => left.localeCompare(right))
        .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`),
    )
    .join("");
  dom.statusFilter.innerHTML = statusOptions;
  dom.statusFilter.value = viewState.status;

  const phaseOptions = ['<option value="">All</option>']
    .concat(
      [...phases]
        .sort((left, right) => left.localeCompare(right))
        .map((phase) => `<option value="${escapeHtml(phase)}">${escapeHtml(phase)}</option>`),
    )
    .join("");
  dom.phaseFilter.innerHTML = phaseOptions;
  dom.phaseFilter.value = viewState.phase;
}

function filterActivities() {
  const query = viewState.search.toLowerCase().trim();
  return viewState.activities.filter((activity) => {
    if (viewState.status && activity.activityStatus !== viewState.status) return false;
    if (viewState.phase && activity.phase !== viewState.phase) return false;
    if (!query) return true;

    return COLUMN_SCHEMA.some((column) => String(activity[column.key] ?? "").toLowerCase().includes(query));
  });
}

function renderTable() {
  const columns = getVisibleColumns();
  const filteredRows = filterActivities();
  const activeProject = getActiveProject();
  dom.stats.textContent = `${activeProject.name}: ${filteredRows.length} shown of ${viewState.activities.length} activities`;
  const orderMap = new Map(viewState.activities.map((activity, index) => [activity.activityId, index + 1]));

  dom.tableHead.innerHTML = `
    <tr>
      <th>#</th>
      <th>Row Actions</th>
      ${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
    </tr>
  `;

  if (!filteredRows.length) {
    dom.tableBody.innerHTML = `<tr><td colspan="${columns.length + 2}"><div class="empty-state">No activities match current filters.</div></td></tr>`;
    requestAnimationFrame(refreshFloatingScrollbar);
    return;
  }

  dom.tableBody.innerHTML = filteredRows
    .map(
      (row) => `
      <tr data-id="${escapeHtml(row.activityId)}">
        <td>${orderMap.get(row.activityId) ?? "-"}</td>
        <td>
          <div class="cell-actions">
            <button class="ghost" data-insert-above="${escapeHtml(row.activityId)}">Insert Above</button>
            <button class="ghost" data-insert-below="${escapeHtml(row.activityId)}">Insert Below</button>
            <button class="danger" data-delete="${escapeHtml(row.activityId)}">Delete</button>
          </div>
        </td>
        ${columns.map((column) => `<td>${buildControl(column, row)}</td>`).join("")}
      </tr>
    `,
    )
    .join("");
  requestAnimationFrame(refreshFloatingScrollbar);
}

function refreshFloatingScrollbar() {
  if (!dom.tableWrap || !dom.floatingXScroll || !dom.floatingXTrack) return;

  const hasHorizontalOverflow = dom.tableWrap.scrollWidth > dom.tableWrap.clientWidth + 1;
  const tableRect = dom.tableWrap.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const tableOnScreen = tableRect.bottom > 0 && tableRect.top < viewportHeight;
  const shouldShow = hasHorizontalOverflow && tableOnScreen;
  dom.floatingXScroll.hidden = !shouldShow;

  if (!shouldShow) return;

  dom.floatingXTrack.style.width = `${dom.tableWrap.scrollWidth}px`;
  dom.floatingXScroll.style.left = `${Math.max(12, tableRect.left)}px`;
  dom.floatingXScroll.style.width = `${Math.max(220, tableRect.width)}px`;

  if (!uiState.syncingTableScroll) {
    uiState.syncingFloatingScroll = true;
    dom.floatingXScroll.scrollLeft = dom.tableWrap.scrollLeft;
    uiState.syncingFloatingScroll = false;
  }
}

function renderColumnVisibility() {
  dom.columnChipGroup.innerHTML = COLUMN_SCHEMA.map((column) => {
    const checked = viewState.visibility[column.key] !== false;
    return `
      <label class="column-option" data-column-label="${escapeHtml(String(column.label).toLowerCase())}">
        <input type="checkbox" data-column="${column.key}" ${checked ? "checked" : ""} />
        <span>${escapeHtml(column.label)}</span>
      </label>
    `;
  }).join("");
  updateColumnVisibilitySummary();
  applyColumnSearch(dom.columnSearchInput.value || "");
  setColumnPanelOpen(uiState.columnPanelOpen);
}

function updateColumnVisibilitySummary() {
  const visibleCount = COLUMN_SCHEMA.filter((column) => viewState.visibility[column.key] !== false).length;
  dom.columnVisibilitySummary.textContent = `${visibleCount} of ${COLUMN_SCHEMA.length} columns visible`;
}

function applyColumnSearch(searchValue) {
  const query = String(searchValue ?? "").trim().toLowerCase();
  dom.columnChipGroup.querySelectorAll(".column-option").forEach((node) => {
    const label = node.dataset.columnLabel || "";
    node.classList.toggle("is-hidden", Boolean(query) && !label.includes(query));
  });
}

function setColumnPanelOpen(isOpen) {
  uiState.columnPanelOpen = Boolean(isOpen);
  dom.columnDropdownToggle.setAttribute("aria-expanded", String(uiState.columnPanelOpen));
  dom.columnDropdownToggle.textContent = `${uiState.columnPanelOpen ? "Hide" : "Select"} Visible Columns ${
    uiState.columnPanelOpen ? "▲" : "▼"
  }`;

  if (uiState.columnPanelCloseTimer) {
    clearTimeout(uiState.columnPanelCloseTimer);
    uiState.columnPanelCloseTimer = null;
  }

  if (!uiState.columnPanelOpen) {
    dom.columnDropdownPanel.classList.remove("is-open");
    uiState.columnPanelCloseTimer = window.setTimeout(() => {
      if (!uiState.columnPanelOpen) {
        dom.columnDropdownPanel.hidden = true;
      }
    }, 170);
    return;
  }

  dom.columnDropdownPanel.hidden = false;
  uiState.columnPanelDropUp = shouldDropColumnPanelUpward();
  dom.columnDropdownPanel.classList.toggle("is-drop-up", uiState.columnPanelDropUp);
  requestAnimationFrame(() => {
    dom.columnDropdownPanel.classList.add("is-open");
  });
}

function estimateColumnPanelHeight() {
  if (!dom.columnDropdownPanel.hidden) {
    return dom.columnDropdownPanel.scrollHeight || 320;
  }
  dom.columnDropdownPanel.hidden = false;
  const estimatedHeight = dom.columnDropdownPanel.scrollHeight || 320;
  dom.columnDropdownPanel.hidden = true;
  return estimatedHeight;
}

function shouldDropColumnPanelUpward() {
  const toggleRect = dom.columnDropdownToggle.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const spaceBelow = viewportHeight - toggleRect.bottom;
  const spaceAbove = toggleRect.top;
  const panelHeight = estimateColumnPanelHeight() + 24;
  return spaceBelow < panelHeight && spaceAbove > spaceBelow;
}

function applyVisibilityPreset(mode) {
  const nextVisibility = {};
  COLUMN_SCHEMA.forEach((column) => {
    if (mode === "all") {
      nextVisibility[column.key] = true;
      return;
    }
    if (mode === "core") {
      nextVisibility[column.key] = IMPORT_REQUIRED_KEYS.includes(column.key);
      return;
    }
    nextVisibility[column.key] = false;
  });

  if (mode === "none") {
    nextVisibility.activityId = true;
  }

  saveColumnVisibility(nextVisibility);
  viewState.visibility = {
    ...viewState.visibility,
    ...nextVisibility,
  };
  renderColumnVisibility();
  renderTable();
}

function refreshFromStorage() {
  viewState.activities = getActivities();
  viewState.visibility = getColumnVisibility();
  populateFilterOptions();
  renderColumnVisibility();
  renderTable();
}

function dependencyReplace(raw, fromId, toId) {
  if (!raw) return "";
  return String(raw)
    .split(",")
    .map((value) => value.trim())
    .map((dependencyId) => (dependencyId === fromId ? toId : dependencyId))
    .join(", ");
}

function handleCellUpdate(activityId, field, value) {
  const editor = dom.defaultEditorInput.value || "Planner";
  if (field === "activityId") {
    const newId = String(value || "").trim();
    if (!newId || newId === activityId) return;
    if (viewState.activities.some((activity) => activity.activityId === newId)) {
      notify(`Activity ID ${newId} already exists.`, "error");
      refreshFromStorage();
      return;
    }

    const next = viewState.activities.map((activity) => {
      if (activity.activityId === activityId) {
        return {
          ...activity,
          activityId: newId,
          lastModifiedBy: editor,
          lastModifiedDate: new Date().toISOString().slice(0, 10),
        };
      }
      return {
        ...activity,
        dependencies: dependencyReplace(activity.dependencies, activityId, newId),
      };
    });
    saveActivities(next);
    refreshFromStorage();
    return;
  }

  updateActivity(activityId, {
    [field]: value,
    lastModifiedBy: editor,
    lastModifiedDate: new Date().toISOString().slice(0, 10),
  });
  refreshFromStorage();
}

const debouncedUpdate = debounce(handleCellUpdate, 250);

function readExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read spreadsheet file."));
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function validateImportColumns(rows) {
  if (!rows.length) {
    return {
      valid: false,
      missingLabels: [...IMPORT_REQUIRED_LABELS],
    };
  }
  const headers = Object.keys(rows[0]);
  const mapped = headers.map((header) => getColumnByHeader(header)?.key).filter(Boolean);
  const missing = IMPORT_REQUIRED_KEYS.filter((required) => !mapped.includes(required));
  return {
    valid: missing.length === 0,
    missingLabels: COLUMN_SCHEMA.filter((column) => missing.includes(column.key)).map((column) => column.label),
  };
}

async function importSpreadsheet() {
  const file = dom.excelInput.files?.[0];
  if (!file) {
    notify("Select an Excel file before import.", "warning");
    return;
  }

  const rows = await readExcel(file);
  const validation = validateImportColumns(rows);
  if (!validation.valid) {
    notify(`Import failed. Missing mandatory columns: ${validation.missingLabels.join(", ")}`, "error");
    return;
  }

  const editor = dom.defaultEditorInput.value || "Planner";
  const mappedActivities = rows.map((row) => ({
    ...mapRowToActivity(row),
    lastModifiedBy: editor,
    lastModifiedDate: new Date().toISOString().slice(0, 10),
  }));

  if (dom.mergeStrategy.value === "replace") {
    saveActivities(mappedActivities);
    notify(`Imported ${mappedActivities.length} activities (replace mode).`, "success");
  } else {
    const current = getActivities().length;
    upsertActivities(mappedActivities);
    const next = getActivities().length;
    notify(`Imported ${mappedActivities.length} rows. Dataset size: ${current} -> ${next}.`, "success");
  }
  dom.excelInput.value = "";
  refreshFromStorage();
}

function exportAsCsv() {
  const rows = viewState.activities.map((activity) => {
    const exportRow = {};
    COLUMN_SCHEMA.forEach((column) => {
      exportRow[column.label] = activity[column.key];
    });
    return exportRow;
  });
  triggerDownload(`activities_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), "text/csv;charset=utf-8;");
}

function exportAsJson() {
  triggerDownload(
    `activities_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(viewState.activities, null, 2),
    "application/json;charset=utf-8;",
  );
}

function wireEvents() {
  dom.addButton.addEventListener("click", () => {
    const draft = buildManualActivityDraft();
    if (!draft.activityName.trim()) {
      notify("Activity Name is required for manual entry.", "warning");
      return;
    }
    const added = addActivity(draft);
    notify(`Added activity ${added.activityId}.`, "success");
    clearManualEntryForm();
    refreshFromStorage();
  });

  dom.addEmptyButton.addEventListener("click", () => {
    addActivity({
      ...createEmptyActivity(),
      lastModifiedBy: dom.defaultEditorInput.value || "Planner",
      lastModifiedDate: new Date().toISOString().slice(0, 10),
    });
    notify("Added editable blank activity row.", "success");
    refreshFromStorage();
  });

  dom.loadSampleButton.addEventListener("click", () => {
    const shouldLoad = confirm("This will replace current activities with sample data. Continue?");
    if (!shouldLoad) return;
    saveActivities(createSampleDataset());
    notify("Loaded sample planning dataset.", "success");
    refreshFromStorage();
  });

  dom.importButton.addEventListener("click", async () => {
    try {
      await importSpreadsheet();
    } catch (error) {
      console.error(error);
      notify(`Import error: ${error.message}`, "error");
    }
  });

  dom.exportCsvButton.addEventListener("click", exportAsCsv);
  dom.exportJsonButton.addEventListener("click", exportAsJson);

  dom.clearButton.addEventListener("click", () => {
    if (!confirm("Clear all activities from local state?")) return;
    clearAllActivities();
    notify("All activities were removed.", "warning");
    refreshFromStorage();
  });

  dom.columnChipGroup.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.column) return;
    const key = target.dataset.column;
    const visibleCount = COLUMN_SCHEMA.filter((column) => viewState.visibility[column.key] !== false).length;
    if (!target.checked && viewState.visibility[key] !== false && visibleCount <= 1) {
      target.checked = true;
      notify("At least one column should remain visible.", "warning");
      return;
    }
    saveColumnVisibility({ [key]: target.checked });
    viewState.visibility[key] = target.checked;
    updateColumnVisibilitySummary();
    renderTable();
  });

  dom.columnDropdownToggle.addEventListener("click", () => {
    setColumnPanelOpen(!uiState.columnPanelOpen);
  });

  dom.columnSearchInput.addEventListener("input", (event) => {
    applyColumnSearch(event.target.value || "");
  });

  dom.columnSelectAllButton.addEventListener("click", () => {
    applyVisibilityPreset("all");
  });

  dom.columnSelectCoreButton.addEventListener("click", () => {
    applyVisibilityPreset("core");
  });

  dom.columnSelectNoneButton.addEventListener("click", () => {
    applyVisibilityPreset("none");
  });

  window.addEventListener("resize", () => {
    if (uiState.columnPanelOpen) {
      setColumnPanelOpen(true);
    }
  });

  document.addEventListener("click", (event) => {
    if (!uiState.columnPanelOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    const withinPanel = dom.columnDropdownPanel.contains(target) || dom.columnDropdownToggle.contains(target);
    if (!withinPanel) {
      setColumnPanelOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && uiState.columnPanelOpen) {
      setColumnPanelOpen(false);
    }
  });

  dom.searchInput.addEventListener("input", (event) => {
    viewState.search = event.target.value || "";
    renderTable();
  });
  dom.statusFilter.addEventListener("change", (event) => {
    viewState.status = event.target.value;
    renderTable();
  });
  dom.phaseFilter.addEventListener("change", (event) => {
    viewState.phase = event.target.value;
    renderTable();
  });

  dom.tableWrap.addEventListener("scroll", () => {
    if (uiState.syncingFloatingScroll) return;
    uiState.syncingTableScroll = true;
    dom.floatingXScroll.scrollLeft = dom.tableWrap.scrollLeft;
    uiState.syncingTableScroll = false;
  });

  dom.floatingXScroll.addEventListener("scroll", () => {
    if (uiState.syncingTableScroll) return;
    uiState.syncingFloatingScroll = true;
    dom.tableWrap.scrollLeft = dom.floatingXScroll.scrollLeft;
    uiState.syncingFloatingScroll = false;
  });

  window.addEventListener("resize", () => {
    requestAnimationFrame(refreshFloatingScrollbar);
  });

  window.addEventListener(
    "scroll",
    () => {
      requestAnimationFrame(refreshFloatingScrollbar);
    },
    { passive: true },
  );

  dom.tableBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!button) return;

    if (button.dataset.insertAbove || button.dataset.insertBelow) {
      const referenceId = button.dataset.insertAbove || button.dataset.insertBelow;
      const referenceIndex = viewState.activities.findIndex((activity) => activity.activityId === referenceId);
      if (referenceIndex === -1) return;
      const insertIndex = button.dataset.insertBelow ? referenceIndex + 1 : referenceIndex;
      const referenceActivity = viewState.activities[referenceIndex] ?? createEmptyActivity();
      const inserted = insertActivityAt(insertIndex, {
        ...createEmptyActivity(),
        phase: referenceActivity.phase,
        priority: referenceActivity.priority,
        resourceDepartment: referenceActivity.resourceDepartment,
        materialOwnership: referenceActivity.materialOwnership,
        materialStatus: referenceActivity.materialStatus,
        lastModifiedBy: dom.defaultEditorInput.value || "Planner",
        lastModifiedDate: new Date().toISOString().slice(0, 10),
      });
      notify(
        `Inserted ${inserted.activityId} ${button.dataset.insertBelow ? "below" : "above"} ${referenceId}.`,
        "success",
      );
      refreshFromStorage();
      return;
    }

    const activityId = button.dataset.delete;
    if (!activityId) return;
    if (!confirm(`Delete activity ${activityId}?`)) return;
    deleteActivity(activityId);
    notify(`Deleted ${activityId}.`, "warning");
    refreshFromStorage();
  });

  dom.tableBody.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const field = target.dataset.field;
    if (!field) return;
    const row = target.closest("tr");
    if (!row?.dataset.id) return;
    debouncedUpdate(row.dataset.id, field, target.value);
  });

  dom.defaultEditorInput.addEventListener("change", (event) => {
    setDefaultEditor(event.target.value || "Planner");
    notify("Default editor updated.", "success");
  });
}

function initialize() {
  setActiveNavigation();
  dom.defaultEditorInput.value = getDefaultEditor();
  dom.mandatoryHint.textContent = `Mandatory import columns: ${IMPORT_REQUIRED_LABELS.join(", ")}`;
  dom.columnDropdownToggle.setAttribute("aria-expanded", "false");
  dom.columnDropdownToggle.textContent = "Select Visible Columns ▼";
  wireEvents();
  initializeProjectToolbar({
    onProjectChange: () => {
      viewState.search = "";
      viewState.status = "";
      viewState.phase = "";
      dom.searchInput.value = "";
      refreshFromStorage();
    },
  });
  refreshFromStorage();
  refreshFloatingScrollbar();
}

initialize();
