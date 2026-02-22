import {
  ACTIVITY_STATUSES,
  COLUMN_SCHEMA,
  IMPORT_REQUIRED_KEYS,
  IMPORT_REQUIRED_LABELS,
  MATERIAL_STATUSES,
  normalizePhase,
  OWNERSHIP_TYPES,
  PRIORITY_LEVELS,
  RISK_LEVELS,
  createEmptyActivity,
  createSampleDataset,
  getColumnByHeader,
  mapRowToActivity,
} from "./schema.js";
import { debounce, escapeHtml, notify, setActiveNavigation, showLoading, showModal, toCsv, triggerDownload } from "./common.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { canUndo, getUndoDescription, pushUndoSnapshot, undo } from "./undo.js";
import { canEditActivityField, canImportExportData, canManageProjects, canModifyActivityStructure } from "./auth.js";
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
  subscribeToStateChanges,
  updateActivity,
  upsertActivities,
} from "./storage.js";

const longTextFields = new Set([
  "subActivity",
  "requiredMaterials",
  "requiredTools",
  "remarks",
  "delayReason",
  "overrideReason",
]);
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
  bulkActions: document.querySelector("#bulk-actions"),
  bulkSelectionCount: document.querySelector("#bulk-selection-count"),
  bulkDeleteBtn: document.querySelector("#bulk-delete-btn"),
  bulkStatusSelect: document.querySelector("#bulk-status-select"),
  bulkStatusApplyBtn: document.querySelector("#bulk-status-apply-btn"),
  loadSampleButton: document.querySelector("#load-sample-btn"),
  importButton: document.querySelector("#import-btn"),
  excelInput: document.querySelector("#excel-input"),
  importDropZone: document.querySelector("#import-drop-zone"),
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
  columnSelectCompactButton: document.querySelector("#column-select-compact-btn"),
  columnSelectNoneButton: document.querySelector("#column-select-none-btn"),
  mandatoryHint: document.querySelector("#mandatory-columns-hint"),
  searchInput: document.querySelector("#search-input"),
  statusFilter: document.querySelector("#status-filter"),
  phaseFilter: document.querySelector("#phase-filter"),
  stats: document.querySelector("#activity-grid-stats"),
  defaultEditorInput: document.querySelector("#default-editor"),
  lastSavedIndicator: document.querySelector("#last-saved-indicator"),
  undoBtn: document.querySelector("#undo-btn"),
};

let viewState = {
  activities: [],
  visibility: getColumnVisibility(),
  search: "",
  status: "",
  phase: "",
  selectedIds: new Set(),
  sortKey: "",
  sortDir: 1,
};

const uiState = {
  columnPanelOpen: false,
  columnPanelDropUp: false,
  columnPanelCloseTimer: null,
  syncingTableScroll: false,
  syncingFloatingScroll: false,
};

let currentUser = null;

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
    requiredMaterials: getInputValue("requiredMaterials"),
    requiredTools: getInputValue("requiredTools"),
    materialLeadTime: Number(getInputValue("materialLeadTime")) || 0,
    dependencies: getInputValue("dependencies"),
    assignedManpower: Number(getInputValue("assignedManpower")) || 0,
    resourceDepartment: getInputValue("resourceDepartment"),
    materialOwnership: getInputValue("materialOwnership"),
    materialStatus: getInputValue("materialStatus"),
    priority: getInputValue("priority"),
    remarks: getInputValue("remarks"),
    lastModifiedBy: dom.defaultEditorInput?.value || "Planner",
    lastModifiedDate: new Date().toISOString().slice(0, 10),
  };
}

const MANUAL_ENTRY_IDS = [
  "activityId",
  "phase",
  "activityName",
  "subActivity",
  "plannedStartDate",
  "plannedEndDate",
  "baseEffortHours",
  "requiredMaterials",
  "requiredTools",
  "materialLeadTime",
  "dependencies",
  "assignedManpower",
  "resourceDepartment",
  "remarks",
];

function clearManualEntryForm() {
  MANUAL_ENTRY_IDS.forEach((id) => {
    const input = document.querySelector(`#${id}`);
    if (input) input.value = "";
  });
}

function getVisibleColumns() {
  return COLUMN_SCHEMA.filter((column) => viewState.visibility[column.key] !== false);
}

function buildControl(column, row) {
  const value = row[column.key] ?? "";
  const editable = canEditActivityField(currentUser, column.key);
  const lockAttribute = editable ? "" : "disabled";
  if (selectMap[column.key]) {
    const options = [...new Set([...(selectMap[column.key] || []), value].filter(Boolean))];
    return `
      <select data-field="${column.key}" ${lockAttribute}>
        ${options
          .map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`)
          .join("")}
      </select>
    `;
  }
  if (column.type === "date") {
    return `<input data-field="${column.key}" type="date" value="${escapeHtml(value)}" ${lockAttribute} />`;
  }
  if (column.type === "number") {
    return `<input data-field="${column.key}" type="number" step="0.1" value="${escapeHtml(value)}" ${lockAttribute} />`;
  }
  if (longTextFields.has(column.key)) {
    return `<textarea data-field="${column.key}" ${lockAttribute}>${escapeHtml(value)}</textarea>`;
  }
  return `<input data-field="${column.key}" type="text" value="${escapeHtml(value)}" ${lockAttribute} />`;
}

function updateBulkStatusOptions() {
  if (!dom.bulkStatusSelect) return;
  const opts = ['<option value="">-- Set status --</option>'].concat(
    ACTIVITY_STATUSES.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`),
  );
  dom.bulkStatusSelect.innerHTML = opts.join("");
}

function populateFilterOptions() {
  const statuses = new Set(ACTIVITY_STATUSES);
  const phases = new Set();
  updateBulkStatusOptions();

  viewState.activities.forEach((activity) => {
    if (activity.activityStatus) statuses.add(activity.activityStatus);
    const p = normalizePhase(activity.phase);
    if (p) phases.add(p);
  });

  const statusOptions = ['<option value="">All</option>']
    .concat(
      [...statuses]
        .sort((left, right) => left.localeCompare(right))
        .map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`),
    )
    .join("");
  if (dom.statusFilter) {
    dom.statusFilter.innerHTML = statusOptions;
    dom.statusFilter.value = viewState.status;
  }

  const phaseOptions = ['<option value="">All</option>']
    .concat(
      [...phases]
        .sort((left, right) => left.localeCompare(right))
        .map((phase) => `<option value="${escapeHtml(phase)}">${escapeHtml(phase)}</option>`),
    )
    .join("");
  if (dom.phaseFilter) {
    dom.phaseFilter.innerHTML = phaseOptions;
    dom.phaseFilter.value = viewState.phase;
  }
}

function filterActivities() {
  const query = viewState.search.toLowerCase().trim();
  const phaseFilter = viewState.phase ? normalizePhase(viewState.phase) : "";
  let rows = viewState.activities.filter((activity) => {
    if (viewState.status && activity.activityStatus !== viewState.status) return false;
    if (phaseFilter && normalizePhase(activity.phase) !== phaseFilter) return false;
    if (!query) return true;
    return COLUMN_SCHEMA.some((column) => String(activity[column.key] ?? "").toLowerCase().includes(query));
  });
  if (viewState.sortKey) {
    const key = viewState.sortKey;
    const dir = viewState.sortDir;
    rows = [...rows].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va ?? "").localeCompare(String(vb ?? ""));
      return dir * (cmp || 0);
    });
  }
  return rows;
}

function renderTable() {
  const columns = getVisibleColumns();
  const filteredRows = filterActivities();
  const activeProject = getActiveProject();
  if (dom.stats) dom.stats.textContent = `${activeProject.name}: ${filteredRows.length} shown of ${viewState.activities.length} activities`;
  const orderMap = new Map(viewState.activities.map((activity, index) => [activity.activityId, index + 1]));

  const canBulk = canModifyActivityStructure(currentUser);
  const sortableKeys = new Set(["activityId", "activityName", "phase", "activityStatus", "completionPercentage", "baseEffortHours", "plannedStartDate"]);
  const sortClass = (key) => {
    if (viewState.sortKey !== key) return "sortable";
    return `sortable sort-${viewState.sortDir > 0 ? "asc" : "desc"}`;
  };
  dom.tableHead.innerHTML = `
    <tr>
      ${canBulk ? '<th class="col-sticky"><input type="checkbox" id="select-all-rows" title="Select all visible" aria-label="Select all visible" /></th>' : ""}
      <th class="col-sticky sortable ${sortClass("activityId")}" data-sort="activityId">#</th>
      <th>Row Actions</th>
      ${columns.map((column) => {
        const isSortable = sortableKeys.has(column.key);
        const sticky = column.key === "activityId" ? "col-sticky " : "";
        const cls = isSortable ? sticky + sortClass(column.key) : sticky || "";
        return `<th class="${cls.trim() || ""}" ${isSortable ? `data-sort="${column.key}"` : ""}>${escapeHtml(column.label)}</th>`;
      }).join("")}
    </tr>
  `;

  if (!filteredRows.length) {
    viewState.selectedIds.clear();
    if (dom.bulkActions) dom.bulkActions.hidden = true;
    dom.tableBody.innerHTML = `<tr><td colspan="${columns.length + (canBulk ? 3 : 2)}"><div class="empty-state">No activities match current filters.</div></td></tr>`;
    requestAnimationFrame(refreshFloatingScrollbar);
    return;
  }

  const selectAllChecked = canBulk && filteredRows.length > 0 && filteredRows.every((r) => viewState.selectedIds.has(r.activityId));
  dom.tableBody.innerHTML = filteredRows
    .map(
      (row) => {
        const checked = viewState.selectedIds.has(row.activityId);
        return `
      <tr data-id="${escapeHtml(row.activityId)}">
        ${canBulk ? `<td class="col-sticky"><input type="checkbox" class="row-select" data-id="${escapeHtml(row.activityId)}" ${checked ? "checked" : ""} /></td>` : ""}
        <td class="col-sticky">${orderMap.get(row.activityId) ?? "-"}</td>
        <td>
          <div class="cell-actions">
            ${
              canModifyActivityStructure(currentUser)
                ? `<button class="ghost" data-insert-above="${escapeHtml(row.activityId)}">Insert Above</button>
                   <button class="ghost" data-insert-below="${escapeHtml(row.activityId)}">Insert Below</button>
                   <button class="danger" data-delete="${escapeHtml(row.activityId)}">Delete</button>`
                : `<span class="small">Status / delay updates only</span>`
            }
          </div>
        </td>
        ${columns
          .map(
            (column) =>
              `<td class="${column.key === "subActivity" ? "col-sub-activity" : ""}${column.key === "activityId" ? " col-sticky" : ""}">${buildControl(column, row)}</td>`,
          )
          .join("")}
      </tr>
    `;
      },
    )
    .join("");
  if (canBulk && dom.bulkActions) {
    dom.bulkActions.hidden = viewState.selectedIds.size === 0;
    if (dom.bulkSelectionCount) dom.bulkSelectionCount.textContent = `${viewState.selectedIds.size} selected`;
  }
  const selectAllEl = document.querySelector("#select-all-rows");
  if (selectAllEl) {
    selectAllEl.checked = selectAllChecked;
    selectAllEl.indeterminate = viewState.selectedIds.size > 0 && !selectAllChecked;
  }
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
  if (!dom.columnChipGroup) return;
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
  if (dom.columnVisibilitySummary) dom.columnVisibilitySummary.textContent = `${visibleCount} of ${COLUMN_SCHEMA.length} columns visible`;
}

function applyColumnSearch(searchValue) {
  const query = String(searchValue ?? "").trim().toLowerCase();
  (dom.columnChipGroup?.querySelectorAll(".column-option") ?? []).forEach((node) => {
    const label = node.dataset.columnLabel || "";
    node.classList.toggle("is-hidden", Boolean(query) && !label.includes(query));
  });
}

function setColumnPanelOpen(isOpen) {
  uiState.columnPanelOpen = Boolean(isOpen);
  if (dom.columnDropdownToggle) {
    dom.columnDropdownToggle.setAttribute("aria-expanded", String(uiState.columnPanelOpen));
    dom.columnDropdownToggle.textContent = `${uiState.columnPanelOpen ? "Hide" : "Select"} Visible Columns ${uiState.columnPanelOpen ? "▲" : "▼"}`;
  }

  if (uiState.columnPanelCloseTimer) {
    clearTimeout(uiState.columnPanelCloseTimer);
    uiState.columnPanelCloseTimer = null;
  }

  if (!uiState.columnPanelOpen) {
    dom.columnDropdownPanel?.classList.remove("is-open");
    uiState.columnPanelCloseTimer = window.setTimeout(() => {
      if (!uiState.columnPanelOpen && dom.columnDropdownPanel) dom.columnDropdownPanel.hidden = true;
    }, 170);
    return;
  }

  if (dom.columnDropdownPanel) dom.columnDropdownPanel.hidden = false;
  uiState.columnPanelDropUp = shouldDropColumnPanelUpward();
  dom.columnDropdownPanel?.classList.toggle("is-drop-up", uiState.columnPanelDropUp);
  requestAnimationFrame(() => {
    dom.columnDropdownPanel?.classList.add("is-open");
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
  if (!dom.columnDropdownToggle) return false;
  const toggleRect = dom.columnDropdownToggle.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const spaceBelow = viewportHeight - toggleRect.bottom;
  const spaceAbove = toggleRect.top;
  const panelHeight = estimateColumnPanelHeight() + 24;
  return spaceBelow < panelHeight && spaceAbove > spaceBelow;
}

const COMPACT_COLUMNS = new Set([
  "activityId",
  "phase",
  "activityName",
  "subActivity",
  "baseEffortHours",
  "plannedStartDate",
  "plannedEndDate",
  "activityStatus",
  "completionPercentage",
  "requiredMaterials",
  "delayReason",
]);

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
    if (mode === "compact") {
      nextVisibility[column.key] = COMPACT_COLUMNS.has(column.key);
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

function applyRoleRestrictions() {
  const canModify = canModifyActivityStructure(currentUser);
  const canManage = canManageProjects(currentUser);
  const canImportExport = canImportExportData(currentUser);
  const lockedMessage = "This role has limited edit permissions.";

  if (!canModify) {
    const minimumVisibility = {
      activityId: true,
      activityName: true,
      activityStatus: true,
      delayReason: true,
    };
    saveColumnVisibility(minimumVisibility);
    viewState.visibility = {
      ...viewState.visibility,
      ...minimumVisibility,
    };
  }

  [
    dom.addButton,
    dom.addEmptyButton,
    dom.columnDropdownToggle,
    dom.columnSelectAllButton,
    dom.columnSelectCoreButton,
    dom.columnSelectCompactButton,
    dom.columnSelectNoneButton,
  ].forEach((button) => {
    if (!button) return;
    button.disabled = !canModify;
    if (!canModify) {
      button.title = lockedMessage;
    } else {
      button.title = "";
    }
  });

  [dom.importButton, dom.exportCsvButton, dom.exportJsonButton].forEach((button) => {
    if (!button) return;
    button.disabled = !canImportExport;
    if (!canImportExport) {
      button.title = lockedMessage;
    } else {
      button.title = "";
    }
  });

  [dom.loadSampleButton, dom.clearButton].forEach((button) => {
    if (!button) return;
    button.disabled = !canManage;
    if (!canManage) {
      button.title = "Restricted to planning and management roles.";
    } else {
      button.title = "";
    }
  });

  if (dom.defaultEditorInput) {
    if (!canModify) {
      dom.defaultEditorInput.value = currentUser.displayName || currentUser.username;
      dom.defaultEditorInput.readOnly = true;
    } else {
      dom.defaultEditorInput.readOnly = false;
    }
  }
}

function refreshFromStorage() {
  viewState.activities = getActivities();
  viewState.visibility = getColumnVisibility();
  populateFilterOptions();
  renderColumnVisibility();
  renderTable();
  updateUndoButton();
}

function updateUndoButton() {
  if (dom.undoBtn) {
    const ok = canUndo();
    dom.undoBtn.style.display = ok ? "" : "none";
    dom.undoBtn.textContent = ok ? `Undo: ${getUndoDescription() || "last action"}` : "Undo";
  }
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

  const normalizedPatch = {
    [field]: value,
    lastModifiedBy: editor,
    lastModifiedDate: new Date().toISOString().slice(0, 10),
  };

  if (field === "completionPercentage") {
    const completion = Math.max(0, Math.min(100, Number(value) || 0));
    normalizedPatch.completionPercentage = completion;
    if (completion >= 100) {
      normalizedPatch.activityStatus = "Completed";
    } else if (completion > 0 && String(viewState.activities.find((row) => row.activityId === activityId)?.activityStatus || "").toLowerCase() === "not started") {
      normalizedPatch.activityStatus = "In Progress";
    }
  }

  if (field === "activityStatus" && String(value || "").trim().toLowerCase() === "completed") {
    normalizedPatch.completionPercentage = 100;
  }

  if (field === "actualEndDate" && String(value || "").trim()) {
    normalizedPatch.activityStatus = "Completed";
    normalizedPatch.completionPercentage = 100;
  }

  updateActivity(activityId, normalizedPatch);
  refreshFromStorage();
}

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

function readCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read CSV file."));
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        if (!lines.length) {
          resolve([]);
          return;
        }
        const parseCsvLine = (line) => {
          const result = [];
          let current = "";
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
              if (line[i + 1] === '"') {
                current += '"';
                i++;
              } else {
                inQuotes = !inQuotes;
              }
            } else if (c === "," && !inQuotes) {
              result.push(current.replace(/^"|"$/g, "").replace(/""/g, '"'));
              current = "";
            } else {
              current += c;
            }
          }
          result.push(current.replace(/^"|"$/g, "").replace(/""/g, '"'));
          return result;
        };
        const headers = parseCsvLine(lines[0]);
        const rows = lines.slice(1).map((line) => {
          const values = parseCsvLine(line);
          const obj = {};
          headers.forEach((h, i) => {
            obj[h] = values[i] ?? "";
          });
          return obj;
        });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsText(file);
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
  const file = dom.excelInput?.files?.[0];
  if (!file) {
    notify("Select an Excel file before import.", "warning");
    return;
  }

  const isCsv = /\.csv$/i.test(file.name);
  const hideLoading = showLoading(isCsv ? "Reading CSV..." : "Reading spreadsheet...");
  let rows = [];
  try {
    rows = isCsv ? await readCsv(file) : await readExcel(file);
  } finally {
    hideLoading();
  }
  const validation = validateImportColumns(rows);
  if (!validation.valid) {
    notify(`Import failed. Missing mandatory columns: ${validation.missingLabels.join(", ")}`, "error");
    return;
  }

  const mergeStrategy = dom.mergeStrategy?.value || "merge";
  const sampleIds = rows
    .slice(0, 5)
    .map((r) => {
      const key = Object.keys(r).find((k) => /activity\s*id|activityid/i.test(String(k)));
      return key ? r[key] : "-";
    })
    .join(", ");

  const result = await showModal({
    title: "Import Preview",
    body: `Found ${rows.length} rows. Strategy: ${mergeStrategy === "replace" ? "Replace all" : "Merge by Activity ID"}. Sample IDs: ${sampleIds}. Proceed?`,
    fields: [],
    primaryLabel: "Import",
    secondaryLabel: "Cancel",
  });
  if (!result) return;

  pushUndoSnapshot(`Import ${rows.length} rows (${mergeStrategy})`);

  const editor = dom.defaultEditorInput?.value || "Planner";
  const mappedActivities = rows.map((row) => ({
    ...mapRowToActivity(row),
    lastModifiedBy: editor,
    lastModifiedDate: new Date().toISOString().slice(0, 10),
  }));

  if (mergeStrategy === "replace") {
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
    if (!canModifyActivityStructure(currentUser)) {
      notify("This role cannot add new activities.", "warning");
      return;
    }
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
    if (!canModifyActivityStructure(currentUser)) {
      notify("This role cannot add new activities.", "warning");
      return;
    }
    addActivity({
      ...createEmptyActivity(),
      lastModifiedBy: dom.defaultEditorInput.value || "Planner",
      lastModifiedDate: new Date().toISOString().slice(0, 10),
    });
    notify("Added editable blank activity row.", "success");
    refreshFromStorage();
  });

  dom.loadSampleButton.addEventListener("click", async () => {
    if (!canManageProjects(currentUser)) {
      notify("This role cannot replace project data.", "warning");
      return;
    }
    const result = await showModal({
      title: "Load Sample Dataset",
      body: "This will replace current activities with sample data. Continue?",
      fields: [],
      primaryLabel: "Load",
      secondaryLabel: "Cancel",
    });
    if (!result) return;
    saveActivities(createSampleDataset());
    notify("Loaded sample planning dataset.", "success");
    refreshFromStorage();
  });

  dom.importButton.addEventListener("click", async () => {
    if (!canImportExportData(currentUser)) {
      notify("This role cannot import data.", "warning");
      return;
    }
    try {
      await importSpreadsheet();
    } catch (error) {
      console.error(error);
      notify(`Import error: ${error.message}`, "error");
    }
  });

  dom.importDropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dom.importDropZone?.classList.add("drag-over");
  });
  dom.importDropZone?.addEventListener("dragleave", () => dom.importDropZone?.classList.remove("drag-over"));
  dom.importDropZone?.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dom.importDropZone?.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file && /\.(xlsx|xls|csv)$/i.test(file.name) && canImportExportData(currentUser)) {
      const dt = new DataTransfer();
      dt.items.add(file);
      dom.excelInput.files = dt.files;
      try {
        await importSpreadsheet();
      } catch (err) {
        notify(`Import error: ${err.message}`, "error");
      }
    }
  });

  dom.exportCsvButton.addEventListener("click", () => {
    if (!canImportExportData(currentUser)) {
      notify("This role cannot export data.", "warning");
      return;
    }
    exportAsCsv();
  });
  dom.exportJsonButton.addEventListener("click", () => {
    if (!canImportExportData(currentUser)) {
      notify("This role cannot export data.", "warning");
      return;
    }
    exportAsJson();
  });

  dom.clearButton.addEventListener("click", async () => {
    if (!canManageProjects(currentUser)) {
      notify("This role cannot clear activities.", "warning");
      return;
    }
    const result = await showModal({
      title: "Clear All Activities",
      body: "Remove all activities from this project? This cannot be undone.",
      fields: [],
      primaryLabel: "Clear",
      secondaryLabel: "Cancel",
      danger: true,
    });
    if (!result) return;
    pushUndoSnapshot("Clear all activities");
    clearAllActivities();
    notify("All activities were removed. Use Ctrl+Z to undo.", "warning");
    refreshFromStorage();
  });

  dom.columnChipGroup.addEventListener("change", (event) => {
    if (!canModifyActivityStructure(currentUser)) {
      notify("Column layout changes are restricted for this role.", "warning");
      renderColumnVisibility();
      return;
    }
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
    if (!canModifyActivityStructure(currentUser)) {
      notify("Column layout changes are restricted for this role.", "warning");
      return;
    }
    setColumnPanelOpen(!uiState.columnPanelOpen);
  });

  dom.columnSearchInput.addEventListener("input", (event) => {
    applyColumnSearch(event.target.value || "");
  });

  dom.columnSelectAllButton.addEventListener("click", () => {
    if (!canModifyActivityStructure(currentUser)) return;
    applyVisibilityPreset("all");
  });

  dom.columnSelectCoreButton.addEventListener("click", () => {
    if (!canModifyActivityStructure(currentUser)) return;
    applyVisibilityPreset("core");
  });

  dom.columnSelectCompactButton?.addEventListener("click", () => {
    if (!canModifyActivityStructure(currentUser)) return;
    applyVisibilityPreset("compact");
  });

  dom.columnSelectNoneButton.addEventListener("click", () => {
    if (!canModifyActivityStructure(currentUser)) return;
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

  dom.searchInput.addEventListener("input", debounce(() => {
    viewState.search = dom.searchInput?.value || "";
    renderTable();
  }, 250));
  dom.statusFilter.addEventListener("change", (event) => {
    viewState.status = event.target.value;
    renderTable();
  });
  dom.phaseFilter.addEventListener("change", (event) => {
    viewState.phase = event.target.value;
    renderTable();
  });

  dom.tableHead.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    if (!key) return;
    viewState.sortDir = viewState.sortKey === key ? -viewState.sortDir : 1;
    viewState.sortKey = key;
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

    if (target.id === "select-all-rows" || target.classList.contains("row-select")) {
      if (target.id === "select-all-rows") {
        const filtered = filterActivities();
        if (target.checked) {
          filtered.forEach((r) => viewState.selectedIds.add(r.activityId));
        } else {
          filtered.forEach((r) => viewState.selectedIds.delete(r.activityId));
        }
      } else {
        const id = target.dataset.id;
        if (id) {
          if (target.checked) viewState.selectedIds.add(id);
          else viewState.selectedIds.delete(id);
        }
      }
      renderTable();
      if (dom.bulkActions) dom.bulkActions.hidden = viewState.selectedIds.size === 0;
      if (dom.bulkSelectionCount) dom.bulkSelectionCount.textContent = `${viewState.selectedIds.size} selected`;
      return;
    }

    const button = target.closest("button");
    if (!button) return;

    if (button.dataset.insertAbove || button.dataset.insertBelow) {
      if (!canModifyActivityStructure(currentUser)) {
        notify("This role cannot add or remove activity rows.", "warning");
        return;
      }
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
    if (!canModifyActivityStructure(currentUser)) {
      notify("This role cannot delete activity rows.", "warning");
      return;
    }
    showModal({
      title: "Delete Activity",
      body: `Delete activity ${activityId}?`,
      fields: [],
      primaryLabel: "Delete",
      secondaryLabel: "Cancel",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      pushUndoSnapshot(`Delete activity ${activityId}`);
      deleteActivity(activityId);
      viewState.selectedIds.delete(activityId);
      notify(`Deleted ${activityId}. Use Ctrl+Z to undo.`, "warning");
      refreshFromStorage();
    });
  });

  dom.tableBody.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const field = target.dataset.field;
    if (!field) return;
    if (!canEditActivityField(currentUser, field)) {
      notify("This field is read-only for your role.", "warning");
      refreshFromStorage();
      return;
    }
    const row = target.closest("tr");
    if (!row?.dataset.id) return;
    handleCellUpdate(row.dataset.id, field, target.value);
  });

  dom.defaultEditorInput?.addEventListener("change", (event) => {
    setDefaultEditor(event.target.value || "Planner");
    notify("Default editor updated.", "success");
  });

  dom.bulkDeleteBtn?.addEventListener("click", async () => {
    if (!canModifyActivityStructure(currentUser) || viewState.selectedIds.size === 0) return;
    const count = viewState.selectedIds.size;
    const idsToDelete = [...viewState.selectedIds];
    const result = await showModal({
      title: "Delete Selected Activities",
      body: `Delete ${count} selected activities? This cannot be undone.`,
      fields: [],
      primaryLabel: "Delete",
      secondaryLabel: "Cancel",
      danger: true,
    });
    if (!result) return;
    pushUndoSnapshot(`Delete ${count} activities`);
    idsToDelete.forEach((id) => deleteActivity(id));
    viewState.selectedIds.clear();
    notify(`Deleted ${count} activities. Use Ctrl+Z to undo.`, "warning");
    refreshFromStorage();
  });

  dom.bulkStatusApplyBtn?.addEventListener("click", () => {
    const status = dom.bulkStatusSelect?.value;
    if (!status || viewState.selectedIds.size === 0) return;
    viewState.selectedIds.forEach((id) => {
      updateActivity(id, { activityStatus: status });
    });
    notify(`Updated ${viewState.selectedIds.size} activities to ${status}.`, "success");
    viewState.selectedIds.clear();
    refreshFromStorage();
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "k") {
        e.preventDefault();
        dom.searchInput?.focus();
      }
      if (e.key === "n") {
        e.preventDefault();
        if (canModifyActivityStructure(currentUser)) dom.addButton?.click();
      }
      if (e.key === "e") {
        e.preventDefault();
        if (canImportExportData(currentUser)) dom.exportCsvButton?.click();
      }
    }
  });
}

function initialize() {
  initShell();
  setActiveNavigation();
  currentUser = initializeAccessShell();
  if (!currentUser) return;
  if (dom.defaultEditorInput) dom.defaultEditorInput.value = getDefaultEditor();
  if (dom.mandatoryHint) dom.mandatoryHint.textContent = `Mandatory import columns: ${IMPORT_REQUIRED_LABELS.join(", ")}`;
  dom.columnDropdownToggle?.setAttribute("aria-expanded", "false");
  if (dom.columnDropdownToggle) dom.columnDropdownToggle.textContent = "Select Visible Columns ▼";
  const params = new URLSearchParams(location.search);
  const statusParam = params.get("status");
  const phaseParam = params.get("phase");
  if (statusParam) {
    viewState.status = statusParam;
    if (dom.statusFilter) dom.statusFilter.value = statusParam;
  }
  if (phaseParam) {
    viewState.phase = normalizePhase(phaseParam) || phaseParam;
    if (dom.phaseFilter) dom.phaseFilter.value = viewState.phase;
  }
  wireEvents();
  applyRoleRestrictions();
  dom.undoBtn?.addEventListener("click", () => {
    const result = undo();
    if (result.ok) refreshFromStorage();
  });
  subscribeToStateChanges(updateUndoButton);
  window.addEventListener("atlas_state_changed", (e) => {
    if (e.detail?.savedAt && dom.lastSavedIndicator) {
      const d = new Date(e.detail.savedAt);
      dom.lastSavedIndicator.textContent = `Saved ${d.toLocaleTimeString()}`;
    }
    updateUndoButton();
  });
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
