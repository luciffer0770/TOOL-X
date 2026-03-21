import { COLUMN_SCHEMA, generateActivityId, sanitizeActivity } from "./schema.js";
import { logAudit } from "./audit.js";
import { idbGetState, idbSetState } from "./idb.js";
import { notify } from "./common.js";
import { getAuthBearerHeaders } from "./auth.js";

const STORAGE_KEY = "industrial_planning_intelligence_state_v1";
export const SAVE_STATUS_EVENT = "industrial_planning_save_status";
const SAVE_RETRY_ATTEMPTS = 3;
const SAVE_RETRY_DELAY_MS = 1000;
const SAVE_DEBOUNCE_MS = 450;

// Backend API mode: when true, state is loaded/saved via /api/state
let _useBackend = false;
let _memoryCache = null;
let _stateReadyPromise = null;
/** Server optimistic-lock version from GET/PUT /api/state (header X-Atlas-State-Version). */
let _serverStateVersion = 0;

function parseStateVersionHeader(res) {
  const h = res.headers.get("X-Atlas-State-Version");
  const n = parseInt(h ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

/** Start loading state. Call once before app init. Resolves when state is ready (from API or localStorage). */
export function stateReady() {
  if (_stateReadyPromise) return _stateReadyPromise;
  _stateReadyPromise = (async () => {
    try {
      const health = await fetch("/api/health");
      if (health.ok) {
        _useBackend = true;
        const res = await fetch("/api/state", { headers: { ...getAuthBearerHeaders() } });
        if (res.status === 401) {
          _serverStateVersion = 0;
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) _memoryCache = normalizeState(JSON.parse(raw));
          } catch (_) {
            _memoryCache = null;
          }
          return;
        }
        if (res.ok) {
          _serverStateVersion = parseStateVersionHeader(res);
          try {
            const data = await res.json();
            if (data && typeof data === "object") _memoryCache = data;
          } catch (_) {}
        }
        return;
      }
    } catch (_) {}
    _useBackend = false;
  })();
  return _stateReadyPromise;
}
const STATE_CHANGE_EVENT = "industrial_planning_state_changed";
const PROJECT_ID_PATTERN = /^PRJ-(\d{4,})$/;
const BASELINE_ID_PATTERN = /^BL-(\d{4,})$/;
const ACTION_ID_PATTERN = /^ACTN-(\d{4,})$/;

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toIsoTimestamp(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function sanitizeAction(rawAction) {
  const action = rawAction ?? {};
  const normalizedStatus = String(action.status || "Open").trim();
  const allowedStatus = new Set(["Open", "In Review", "Closed"]);
  const normalizedPriority = String(action.priority || "Medium").trim();
  const allowedPriority = new Set(["Low", "Medium", "High", "Critical"]);

  return {
    id: String(action.id || "").trim(),
    activityId: String(action.activityId || "").trim(),
    title: String(action.title || "").trim(),
    owner: String(action.owner || "").trim(),
    dueDate: toIsoDate(action.dueDate),
    status: allowedStatus.has(normalizedStatus) ? normalizedStatus : "Open",
    priority: allowedPriority.has(normalizedPriority) ? normalizedPriority : "Medium",
    notes: String(action.notes || "").trim(),
    createdBy: String(action.createdBy || "Planner").trim(),
    createdAt: toIsoTimestamp(action.createdAt),
    updatedAt: toIsoTimestamp(action.updatedAt),
  };
}

function sanitizeBaseline(rawBaseline, fallbackName) {
  const baseline = rawBaseline ?? {};
  const normalizedName = String(baseline.name || "").trim() || fallbackName;
  const rawActivities = Array.isArray(baseline.activities) ? baseline.activities : [];
  return {
    id: String(baseline.id || "").trim(),
    name: normalizedName,
    activities: rawActivities.map((activity) => sanitizeActivity(activity)),
    createdBy: String(baseline.createdBy || "Planner").trim(),
    createdAt: toIsoTimestamp(baseline.createdAt),
  };
}

function createDefaultVisibility() {
  const defaultVisibility = {};
  COLUMN_SCHEMA.forEach((column) => {
    defaultVisibility[column.key] = true;
  });
  return defaultVisibility;
}

function defaultProjectSetup() {
  return {
    projectCode: "",
    customerOem: "",
    engineType: "",
    engineSerialNo: "",
    trolleyCode: "",
    trolleyLocation: "",
    projectManager: "",
    plannedStartDate: "",
    targetFinishDate: "",
    contractReference: "",
    workingHoursPerDay: 8,
    warningThresholdDays: 7,
    criticalThresholdDays: 3,
  };
}

function numOr(raw, fallback) {
  const x = Number(raw);
  return Number.isFinite(x) ? x : fallback;
}

function sanitizeProjectSetup(raw) {
  const d = defaultProjectSetup();
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    projectCode: String(raw.projectCode ?? "").trim(),
    customerOem: String(raw.customerOem ?? "").trim(),
    engineType: String(raw.engineType ?? "").trim(),
    engineSerialNo: String(raw.engineSerialNo ?? "").trim(),
    trolleyCode: String(raw.trolleyCode ?? "").trim(),
    trolleyLocation: String(raw.trolleyLocation ?? "").trim(),
    projectManager: String(raw.projectManager ?? "").trim(),
    plannedStartDate: String(raw.plannedStartDate ?? "").trim().slice(0, 10),
    targetFinishDate: String(raw.targetFinishDate ?? "").trim().slice(0, 10),
    contractReference: String(raw.contractReference ?? "").trim(),
    workingHoursPerDay: numOr(raw.workingHoursPerDay, d.workingHoursPerDay),
    warningThresholdDays: numOr(raw.warningThresholdDays, d.warningThresholdDays),
    criticalThresholdDays: numOr(raw.criticalThresholdDays, d.criticalThresholdDays),
  };
}

function defaultEngineSummary() {
  return {
    engineNameModel: "",
    programProject: "",
    customer: "",
    requiredTools: "",
    requiredMaterials: "",
    preparationPhases: "",
    keyMilestones: "",
    dependencies: "",
    notesSummary: "",
  };
}

function sanitizeEngineSummary(raw) {
  const d = defaultEngineSummary();
  if (!raw || typeof raw !== "object") return { ...d };
  const out = { ...d };
  Object.keys(d).forEach((k) => {
    out[k] = String(raw[k] ?? "").trim();
  });
  return out;
}

function sanitizeTeamMember(raw) {
  return {
    id: String(raw?.id || "").trim() || `TM-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: String(raw?.name ?? "").trim(),
    role: String(raw?.role ?? "").trim(),
    department: String(raw?.department ?? "").trim(),
    email: String(raw?.email ?? "").trim(),
    phone: String(raw?.phone ?? "").trim(),
    accessLevel: String(raw?.accessLevel ?? "Standard").trim(),
    notes: String(raw?.notes ?? "").trim(),
  };
}

function sanitizeTeamMembers(list) {
  if (!Array.isArray(list)) return [];
  return list.map((m) => sanitizeTeamMember(m));
}

const ENGINE_PARSE_STATUSES = new Set(["none", "ok", "partial", "failed", "manual"]);

function sanitizeEngineDocument(raw) {
  const summary = sanitizeEngineSummary(raw?.summary);
  const summaryManual = sanitizeEngineSummary(raw?.summaryManual);
  const ps = String(raw?.parseStatus ?? "none");
  const parseStatus = ENGINE_PARSE_STATUSES.has(ps) ? ps : "none";
  return {
    id: String(raw?.id || "").trim() || `EDOC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fileName: String(raw?.fileName ?? "").trim(),
    mimeType: String(raw?.mimeType ?? "").trim(),
    uploadedAt: String(raw?.uploadedAt || new Date().toISOString()),
    blobId: String(raw?.blobId ?? "").trim(),
    customer: String(raw?.customer ?? "").trim(),
    engineRef: String(raw?.engineRef ?? "").trim(),
    projectRef: String(raw?.projectRef ?? "").trim(),
    summary,
    summaryManual,
    parseStatus,
    parseNote: String(raw?.parseNote ?? "").trim().slice(0, 2000),
  };
}

function sanitizeEngineDocuments(list) {
  if (!Array.isArray(list)) return [];
  return list.map((d) => sanitizeEngineDocument(d));
}

function cloneTeamMembersForDuplicate(list) {
  return sanitizeTeamMembers(list).map((m) => ({ ...m, id: `TM-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }));
}

function cloneEngineDocsForDuplicate(list) {
  return sanitizeEngineDocuments(list).map((d) => ({
    ...d,
    id: `EDOC-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    blobId: "",
    uploadedAt: new Date().toISOString(),
    parseStatus: d.parseStatus === "none" ? "none" : "manual",
  }));
}

function createProject(id, name, activities = [], baselines = [], actions = [], extras = {}) {
  const normalizedBaselines = baselines.map((baseline, index) =>
    sanitizeBaseline(baseline, `Baseline v${index + 1}`),
  );
  const normalizedActions = actions.map((action) => sanitizeAction(action));
  const setup = sanitizeProjectSetup(extras.setup);
  const teamMembers = sanitizeTeamMembers(extras.teamMembers);
  const engineDocuments = sanitizeEngineDocuments(extras.engineDocuments);
  return {
    id,
    name,
    activities: activities.map((activity) => sanitizeActivity(activity)),
    baselines: normalizedBaselines,
    actions: normalizedActions,
    setup,
    teamMembers,
    engineDocuments,
  };
}

function baseState() {
  const defaultProjectId = "PRJ-0001";
  return {
    projects: [createProject(defaultProjectId, "Project 1", [])],
    activeProjectId: defaultProjectId,
    settings: {
      tableColumnVisibility: createDefaultVisibility(),
      defaultEditor: "Planner",
      activityTemplates: [],
      savedFilters: [],
    },
  };
}

function getNextProjectId(projects) {
  let max = 0;
  projects.forEach((project) => {
    const match = PROJECT_ID_PATTERN.exec(project.id || "");
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });
  return `PRJ-${String(max + 1).padStart(4, "0")}`;
}

function getNextBaselineId(baselines) {
  let max = 0;
  baselines.forEach((baseline) => {
    const match = BASELINE_ID_PATTERN.exec(String(baseline?.id || ""));
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });
  return `BL-${String(max + 1).padStart(4, "0")}`;
}

function getNextActionId(actions) {
  let max = 0;
  actions.forEach((action) => {
    const match = ACTION_ID_PATTERN.exec(String(action?.id || ""));
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });
  return `ACTN-${String(max + 1).padStart(4, "0")}`;
}

function normalizeProjectName(rawName, index) {
  const trimmed = String(rawName ?? "").trim();
  return trimmed || `Project ${index + 1}`;
}

function readRawState() {
  if (_memoryCache) return _memoryCache;
  if (_useBackend) return baseState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      try {
        idbGetState().then((idbRaw) => {
          if (idbRaw) {
            try {
              localStorage.setItem(STORAGE_KEY, idbRaw);
              window.dispatchEvent(new CustomEvent("industrial_planning_state_changed", { detail: { key: STORAGE_KEY, savedAt: new Date().toISOString() } }));
              if (!location.pathname.endsWith("/activities.html")) location.reload();
            } catch (_) {}
          }
        }).catch(() => {});
      } catch (_) {}
      return baseState();
    }
    const parsed = JSON.parse(raw);
    return parsed ?? baseState();
  } catch (error) {
    console.error("Failed to parse saved state:", error);
    return baseState();
  }
}

function normalizeState(state) {
  const defaults = baseState();
  let normalizedProjects = [];

  if (Array.isArray(state.projects) && state.projects.length) {
    state.projects.forEach((project, index) => {
      let id = String(project?.id ?? "").trim();
      if (!id || normalizedProjects.some((entry) => entry.id === id)) {
        id = getNextProjectId(normalizedProjects);
      }
      const name = normalizeProjectName(project?.name, index);
      const rawActivities = Array.isArray(project?.activities)
        ? project.activities
        : Array.isArray(project?.items)
          ? project.items
          : [];
      const rawBaselines = Array.isArray(project?.baselines) ? project.baselines : [];
      const rawActions = Array.isArray(project?.actions) ? project.actions : [];
      normalizedProjects.push(
        createProject(id, name, rawActivities, rawBaselines, rawActions, {
          setup: project?.setup,
          teamMembers: project?.teamMembers,
          engineDocuments: project?.engineDocuments,
        }),
      );
    });
  } else if (Array.isArray(state.activities)) {
    // Migration path from older single-project state.
    normalizedProjects = [createProject(defaults.projects[0].id, defaults.projects[0].name, state.activities)];
  } else {
    normalizedProjects = defaults.projects;
  }

  if (!normalizedProjects.length) {
    normalizedProjects = defaults.projects;
  }

  let activeProjectId = String(state.activeProjectId ?? "").trim();
  if (!normalizedProjects.some((project) => project.id === activeProjectId)) {
    activeProjectId = normalizedProjects[0].id;
  }

  const settings = {
    ...defaults.settings,
    ...(state.settings ?? {}),
  };

  settings.tableColumnVisibility = {
    ...createDefaultVisibility(),
    ...(state.settings?.tableColumnVisibility ?? {}),
  };
  if (!Array.isArray(settings.activityTemplates)) settings.activityTemplates = [];
  if (!Array.isArray(settings.savedFilters)) settings.savedFilters = [];
  if (!Array.isArray(settings.savedScenarios)) settings.savedScenarios = [];

  return {
    projects: normalizedProjects,
    activeProjectId,
    settings,
  };
}

function emitSaveStatus(status, detail = {}) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(SAVE_STATUS_EVENT, { detail: { status, ...detail } }));
  }
}

let _saveDebounceTimer = null;
let _pendingPayload = null;

function flushPendingSave() {
  if (!_pendingPayload) return;
  const toSave = _pendingPayload;
  _pendingPayload = null;
  if (_saveDebounceTimer) {
    clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = null;
  }
  if (_useBackend) {
    try {
      fetch("/api/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(_serverStateVersion),
          ...getAuthBearerHeaders(),
        },
        body: toSave,
        keepalive: true,
      });
    } catch (_) {}
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, toSave);
      idbSetState(toSave).catch(() => {});
    } catch (_) {}
  }
}

function schedulePersist(payload) {
  _pendingPayload = payload;
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(() => {
    _saveDebounceTimer = null;
    const toSave = _pendingPayload;
    _pendingPayload = null;
    if (toSave) doPersist(toSave);
  }, SAVE_DEBOUNCE_MS);
  if (typeof window !== "undefined" && !window.__atlasFlushBound) {
    window.__atlasFlushBound = true;
    window.addEventListener("beforeunload", flushPendingSave);
  }
}

function doPersist(payload) {
  if (_useBackend) {
    putStateWithRetry(payload)
      .then((result) => {
        if (result?.ok) {
          emitSaveStatus("saved", { savedAt: new Date().toISOString() });
        } else if (result?.conflict) {
          emitSaveStatus("conflict", { reloaded: true });
        } else {
          throw new Error("Save failed");
        }
      })
      .catch((e) => {
        console.error("[storage] Backend save error:", e);
        emitSaveStatus("error", { error: String(e?.message || e) });
        notify("Save failed. Check your connection and try again.", "error");
      });
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, payload);
      emitSaveStatus("saved", { savedAt: new Date().toISOString() });
      idbSetState(payload).catch((e) => console.error("[storage] writeState idbSetState error", e));
    } catch (err) {
      console.error("[storage] writeState failed:", err);
      emitSaveStatus("error", { error: String(err) });
      notify("Save failed. Storage may be full.", "error");
    }
  }
}

async function reloadStateFromServerAfterConflict() {
  const res = await fetch("/api/state", { headers: { ...getAuthBearerHeaders() } });
  if (!res.ok) return;
  _serverStateVersion = parseStateVersionHeader(res);
  const data = await res.json();
  if (data && typeof data === "object") {
    _memoryCache = normalizeState(data);
    emitStateChange();
  }
  emitSaveStatus("conflict", { reloaded: true, version: _serverStateVersion });
  notify("Workspace was updated elsewhere — loaded the latest version from the server.", "warning");
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("industrial_planning_state_conflict", { detail: { version: _serverStateVersion } }),
    );
  }
}

async function putStateWithRetry(payload) {
  const sendPut = () =>
    fetch("/api/state", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(_serverStateVersion),
        ...getAuthBearerHeaders(),
      },
      body: payload,
    });

  for (let attempt = 1; attempt <= SAVE_RETRY_ATTEMPTS; attempt++) {
    try {
      let r = await sendPut();
      if (r.ok) {
        let body = {};
        try {
          body = await r.json();
        } catch (_) {
          body = {};
        }
        const hv = r.headers.get("X-Atlas-State-Version");
        if (hv != null && hv !== "") _serverStateVersion = parseInt(hv, 10) || _serverStateVersion;
        else if (typeof body.version === "number") _serverStateVersion = body.version;
        return { ok: true };
      }
      if (r.status === 409) {
        await reloadStateFromServerAfterConflict();
        return { ok: false, conflict: true };
      }
      if (r.status === 428) {
        await reloadStateFromServerAfterConflict();
        r = await sendPut();
        if (r.ok) {
          let body = {};
          try {
            body = await r.json();
          } catch (_) {
            body = {};
          }
          const hv = r.headers.get("X-Atlas-State-Version");
          if (hv != null && hv !== "") _serverStateVersion = parseInt(hv, 10) || _serverStateVersion;
          else if (typeof body.version === "number") _serverStateVersion = body.version;
          return { ok: true };
        }
        if (r.status === 409) {
          await reloadStateFromServerAfterConflict();
          return { ok: false, conflict: true };
        }
      }
      const errText = await r.text();
      throw new Error(errText || `HTTP ${r.status}`);
    } catch (e) {
      if (attempt === SAVE_RETRY_ATTEMPTS) throw e;
      await new Promise((resolve) => setTimeout(resolve, SAVE_RETRY_DELAY_MS));
    }
  }
  return { ok: false };
}

function writeState(state) {
  const normalized = normalizeState(state);
  const payload = JSON.stringify(normalized);
  _memoryCache = normalized;
  emitSaveStatus("saving");
  schedulePersist(payload);
  emitStateChange();
}

function emitStateChange() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const now = new Date();
  window.dispatchEvent(
    new CustomEvent(STATE_CHANGE_EVENT, {
      detail: {
        key: STORAGE_KEY,
        savedAt: now.toISOString(),
      },
    }),
  );
}

function getActiveProjectIndex(state) {
  let index = state.projects.findIndex((project) => project.id === state.activeProjectId);
  if (index === -1) {
    state.activeProjectId = state.projects[0].id;
    index = 0;
  }
  return index;
}

function getActiveProjectRecord(state) {
  return state.projects[getActiveProjectIndex(state)];
}

function ensureUniqueActivityId(activities, candidateId) {
  const activityIds = new Set(activities.map((activity) => activity.activityId));
  if (!candidateId || activityIds.has(candidateId)) {
    return generateActivityId(activities);
  }
  return candidateId;
}

export function getState() {
  return normalizeState(readRawState());
}

export function saveState(nextState) {
  writeState(normalizeState(nextState));
}

export function getProjects() {
  const state = getState();
  return state.projects.map((project) => ({
    id: project.id,
    name: project.name,
    activityCount: project.activities.length,
    isActive: project.id === state.activeProjectId,
  }));
}

export function getActiveProject() {
  const state = getState();
  const project = getActiveProjectRecord(state);
  return {
    id: project.id,
    name: project.name,
    activities: project.activities.map((activity) => sanitizeActivity(activity)),
    baselines: (project.baselines ?? []).map((baseline, index) => sanitizeBaseline(baseline, `Baseline v${index + 1}`)),
    actions: (project.actions ?? []).map((action) => sanitizeAction(action)),
    setup: sanitizeProjectSetup(project.setup),
    teamMembers: sanitizeTeamMembers(project.teamMembers),
    engineDocuments: sanitizeEngineDocuments(project.engineDocuments),
  };
}

export function setActiveProject(projectId) {
  const state = getState();
  const index = state.projects.findIndex((project) => project.id === projectId);
  if (index === -1) return false;
  state.activeProjectId = projectId;
  saveState(state);
  return true;
}

export function addProject(projectName) {
  const state = getState();
  const id = getNextProjectId(state.projects);
  const name = normalizeProjectName(projectName, state.projects.length);
  const project = createProject(id, name, []);
  state.projects.push(project);
  state.activeProjectId = project.id;
  saveState(state);
  return project;
}

export function duplicateProject(projectId, projectName) {
  const state = getState();
  const sourceProject = state.projects.find((project) => project.id === projectId);
  if (!sourceProject) return null;

  const id = getNextProjectId(state.projects);
  const fallbackName = `${sourceProject.name} Copy`;
  const normalizedName = String(projectName ?? "").trim() || fallbackName;
  const duplicatedProject = createProject(
    id,
    normalizedName,
    sourceProject.activities.map((activity) => sanitizeActivity({ ...activity })),
    sourceProject.baselines ?? [],
    sourceProject.actions ?? [],
    {
      setup: sourceProject.setup,
      teamMembers: cloneTeamMembersForDuplicate(sourceProject.teamMembers),
      engineDocuments: cloneEngineDocsForDuplicate(sourceProject.engineDocuments),
    },
  );

  state.projects.push(duplicatedProject);
  state.activeProjectId = duplicatedProject.id;
  saveState(state);
  return duplicatedProject;
}

export function renameProject(projectId, projectName) {
  const state = getState();
  const index = state.projects.findIndex((project) => project.id === projectId);
  if (index === -1) return null;
  state.projects[index].name = normalizeProjectName(projectName, index);
  saveState(state);
  return state.projects[index];
}

export function deleteProject(projectId) {
  const state = getState();
  if (state.projects.length <= 1) {
    return {
      deleted: false,
      reason: "At least one project must remain.",
    };
  }

  const nextProjects = state.projects.filter((project) => project.id !== projectId);
  if (nextProjects.length === state.projects.length) {
    return {
      deleted: false,
      reason: "Project not found.",
    };
  }

  state.projects = nextProjects;
  if (!state.projects.some((project) => project.id === state.activeProjectId)) {
    state.activeProjectId = state.projects[0].id;
  }
  saveState(state);
  return {
    deleted: true,
    activeProjectId: state.activeProjectId,
  };
}

export function getActivities() {
  return getActiveProject().activities;
}

export function saveActivities(activities) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  project.activities = activities.map((activity) => sanitizeActivity(activity));
  try {
    saveState(state);
    logAudit("Save activities", { count: activities.length });
    if (localStorage.getItem("atlas_debug_verbose") === "1") {
      // eslint-disable-next-line no-console
      console.debug("[storage] saveActivities saved", { count: activities.length });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[storage] saveActivities error", err);
  }
}

export function clearAllActivities() {
  const state = getState();
  const project = getActiveProjectRecord(state);
  project.activities = [];
  try {
    saveState(state);
    logAudit("Clear all activities");
    if (localStorage.getItem("atlas_debug_verbose") === "1") {
      // eslint-disable-next-line no-console
      console.debug("[storage] clearAllActivities performed");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[storage] clearAllActivities error", err);
  }
}

export function addActivity(activity) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const sanitized = sanitizeActivity(activity);
  sanitized.activityId = ensureUniqueActivityId(project.activities, sanitized.activityId);
  project.activities.push(sanitized);
  try {
    saveState(state);
    logAudit("Add activity", { activityId: sanitized.activityId });
    if (localStorage.getItem("atlas_debug_verbose") === "1") {
      // eslint-disable-next-line no-console
      console.debug("[storage] addActivity", sanitized.activityId);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[storage] addActivity error", err);
  }
  return sanitized;
}

export function insertActivityAt(index, activity) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const sanitized = sanitizeActivity(activity);
  sanitized.activityId = ensureUniqueActivityId(project.activities, sanitized.activityId);
  const clampedIndex = Math.max(0, Math.min(Number.isFinite(Number(index)) ? Number(index) : 0, project.activities.length));
  project.activities.splice(clampedIndex, 0, sanitized);
  try {
    saveState(state);
    if (localStorage.getItem("atlas_debug_verbose") === "1") {
      // eslint-disable-next-line no-console
      console.debug("[storage] insertActivityAt", { index: clampedIndex, id: sanitized.activityId });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[storage] insertActivityAt error", err);
  }
  return sanitized;
}

export function upsertActivities(incomingActivities) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const byId = new Map(project.activities.map((activity) => [activity.activityId, activity]));
  incomingActivities.forEach((incoming) => {
    const sanitized = sanitizeActivity(incoming);
    if (!sanitized.activityId) {
      sanitized.activityId = generateActivityId([...byId.values()]);
    }
    byId.set(sanitized.activityId, { ...byId.get(sanitized.activityId), ...sanitized });
  });
  project.activities = [...byId.values()].map((activity) => sanitizeActivity(activity));
  try {
    saveState(state);
    logAudit("Import/upsert activities", { count: incomingActivities.length });
    if (localStorage.getItem("atlas_debug_verbose") === "1") {
      // eslint-disable-next-line no-console
      console.debug("[storage] upsertActivities", incomingActivities.length);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[storage] upsertActivities error", err);
  }
  return project.activities;
}

export function updateActivity(activityId, patch) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const index = project.activities.findIndex((activity) => activity.activityId === activityId);
  if (index === -1) return null;
  const existing = project.activities[index];
  const updated = sanitizeActivity({
    ...existing,
    ...patch,
    lastModifiedDate: patch.lastModifiedDate ?? new Date().toISOString().slice(0, 10),
  });
  project.activities[index] = updated;
  try {
    saveState(state);
    logAudit("Update activity", { activityId });
    if (localStorage.getItem("atlas_debug_verbose") === "1") {
      // eslint-disable-next-line no-console
      console.debug("[storage] updateActivity", activityId);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[storage] updateActivity error", err);
  }
  return updated;
}

export function deleteActivity(activityId) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  project.activities = project.activities.filter((activity) => activity.activityId !== activityId);
  try {
    saveState(state);
    logAudit("Delete activity", { activityId });
    if (localStorage.getItem("atlas_debug_verbose") === "1") {
      // eslint-disable-next-line no-console
      console.debug("[storage] deleteActivity", activityId);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[storage] deleteActivity error", err);
  }
}

export function getProjectBaselines() {
  const state = getState();
  const project = getActiveProjectRecord(state);
  return (project.baselines ?? [])
    .map((baseline, index) => sanitizeBaseline(baseline, `Baseline v${index + 1}`))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export function addProjectBaseline({ name = "", createdBy = "Planner" } = {}) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  if (!Array.isArray(project.baselines)) {
    project.baselines = [];
  }
  const baselineName = String(name || "").trim() || `Baseline v${project.baselines.length + 1}`;
  const baseline = sanitizeBaseline(
    {
      id: getNextBaselineId(project.baselines),
      name: baselineName,
      activities: project.activities.map((activity) => sanitizeActivity(activity)),
      createdBy: String(createdBy || "Planner").trim(),
      createdAt: new Date().toISOString(),
    },
    baselineName,
  );
  project.baselines.push(baseline);
  saveState(state);
  return baseline;
}

export function restoreProjectToBaseline(baselineId) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const baseline = (project.baselines || []).find((b) => b.id === baselineId);
  if (!baseline || !Array.isArray(baseline.activities)) return false;
  project.activities = baseline.activities.map((a) => sanitizeActivity(a));
  saveState(state);
  return true;
}

export function getProjectActions() {
  const state = getState();
  const project = getActiveProjectRecord(state);
  return (project.actions ?? []).map((action) => sanitizeAction(action));
}

export function addProjectAction(actionInput) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  if (!Array.isArray(project.actions)) {
    project.actions = [];
  }
  const action = sanitizeAction({
    ...actionInput,
    id: getNextActionId(project.actions),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  project.actions.push(action);
  saveState(state);
  return action;
}

export function updateProjectAction(actionId, patch) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  if (!Array.isArray(project.actions)) {
    project.actions = [];
  }
  const index = project.actions.findIndex((action) => action.id === actionId);
  if (index === -1) return null;
  const updated = sanitizeAction({
    ...project.actions[index],
    ...patch,
    id: actionId,
    updatedAt: new Date().toISOString(),
  });
  project.actions[index] = updated;
  saveState(state);
  return updated;
}

export function deleteProjectAction(actionId) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  if (!Array.isArray(project.actions)) {
    project.actions = [];
    saveState(state);
    return;
  }
  project.actions = project.actions.filter((action) => action.id !== actionId);
  saveState(state);
}

export function getDashboardKpiConfig() {
  const c = getState().settings.dashboardKpiConfig || {};
  return {
    order: Array.isArray(c.order) ? c.order : [],
    hidden: Array.isArray(c.hidden) ? c.hidden : [],
  };
}

export function saveDashboardKpiConfig(config) {
  const state = getState();
  state.settings.dashboardKpiConfig = { ...config };
  saveState(state);
}

export function getColumnVisibility() {
  return getState().settings.tableColumnVisibility;
}

export function saveColumnVisibility(visibility) {
  const state = getState();
  state.settings.tableColumnVisibility = {
    ...state.settings.tableColumnVisibility,
    ...visibility,
  };
  saveState(state);
}

export function setDefaultEditor(editorName) {
  const state = getState();
  state.settings.defaultEditor = editorName || "Planner";
  saveState(state);
}

export function getDefaultEditor() {
  return getState().settings.defaultEditor || "Planner";
}

export function getActivityTemplates() {
  return getState().settings.activityTemplates || [];
}

export function saveActivityTemplate(name, activity) {
  const state = getState();
  if (!state.settings.activityTemplates) state.settings.activityTemplates = [];
  const id = "TMPL-" + Date.now();
  state.settings.activityTemplates.push({ id, name: String(name || "Template").trim(), activity: sanitizeActivity(activity) });
  saveState(state);
  return state.settings.activityTemplates[state.settings.activityTemplates.length - 1];
}

export function deleteActivityTemplate(templateId) {
  const state = getState();
  if (!state.settings.activityTemplates) return;
  state.settings.activityTemplates = state.settings.activityTemplates.filter((t) => t.id !== templateId);
  saveState(state);
}

export function getSavedFilters() {
  return getState().settings.savedFilters || [];
}

export function getSavedScenarios() {
  return getState().settings.savedScenarios || [];
}

export function saveScenario({ name = "", scenario = {}, result = {} } = {}) {
  const state = getState();
  if (!state.settings.savedScenarios) state.settings.savedScenarios = [];
  const id = "SCN-" + Date.now();
  state.settings.savedScenarios.push({
    id,
    name: String(name || "Unnamed scenario").trim(),
    scenario: { ...scenario },
    result: { ...result },
    savedAt: new Date().toISOString(),
  });
  saveState(state);
  return state.settings.savedScenarios[state.settings.savedScenarios.length - 1];
}

export function deleteScenario(scenarioId) {
  const state = getState();
  if (!state.settings.savedScenarios) return;
  state.settings.savedScenarios = state.settings.savedScenarios.filter((s) => s.id !== scenarioId);
  saveState(state);
}

export function saveFilterPreset(name, filter) {
  const state = getState();
  if (!state.settings.savedFilters) state.settings.savedFilters = [];
  const id = "FLT-" + Date.now();
  state.settings.savedFilters.push({ id, name: String(name || "Filter").trim(), ...filter });
  saveState(state);
  return state.settings.savedFilters[state.settings.savedFilters.length - 1];
}

export function deleteFilterPreset(presetId) {
  const state = getState();
  if (!state.settings.savedFilters) return;
  state.settings.savedFilters = state.settings.savedFilters.filter((f) => f.id !== presetId);
  saveState(state);
}

export function updateActiveProjectSetup(patch) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const merged = { ...sanitizeProjectSetup(project.setup), ...(patch && typeof patch === "object" ? patch : {}) };
  project.setup = sanitizeProjectSetup(merged);
  saveState(state);
  return project.setup;
}

export function setActiveProjectDisplayName(name) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const index = state.projects.findIndex((p) => p.id === project.id);
  project.name = normalizeProjectName(name, Math.max(0, index));
  saveState(state);
  return project.name;
}

export function replaceActiveTeamMembers(members) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  project.teamMembers = sanitizeTeamMembers(members);
  saveState(state);
}

export function getMergedEngineSummary(doc) {
  const base = sanitizeEngineSummary(doc?.summary);
  const manual = sanitizeEngineSummary(doc?.summaryManual);
  const out = { ...base };
  Object.keys(base).forEach((k) => {
    if (String(manual[k] || "").trim()) out[k] = manual[k];
  });
  return out;
}

export function upsertEngineDocument(doc) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  if (!Array.isArray(project.engineDocuments)) project.engineDocuments = [];
  const sanitized = sanitizeEngineDocument(doc);
  const i = project.engineDocuments.findIndex((d) => d.id === sanitized.id);
  if (i === -1) project.engineDocuments.push(sanitized);
  else project.engineDocuments[i] = { ...project.engineDocuments[i], ...sanitized };
  saveState(state);
  return sanitized;
}

export function deleteEngineDocument(docId) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  if (!Array.isArray(project.engineDocuments)) project.engineDocuments = [];
  project.engineDocuments = project.engineDocuments.filter((d) => d.id !== docId);
  saveState(state);
}

export function addActivityComment(activityId, text, author) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const index = project.activities.findIndex((a) => a.activityId === activityId);
  if (index === -1) return null;
  const comments = project.activities[index].comments || [];
  const comment = {
    id: "CMT-" + Date.now(),
    text: String(text || "").trim(),
    author: String(author || "Planner").trim(),
    createdAt: new Date().toISOString(),
  };
  comments.push(comment);
  project.activities[index].comments = comments;
  saveState(state);
  return comment;
}

export function bulkUpdateActivities(activityIds, patch) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  let count = 0;
  project.activities.forEach((a) => {
    if (activityIds.includes(a.activityId)) {
      Object.assign(a, sanitizeActivity({ ...a, ...patch, activityId: a.activityId }));
      count++;
    }
  });
  saveState(state);
  return count;
}

export function subscribeToStateChanges(listener) {
  if (typeof window === "undefined" || typeof listener !== "function") {
    return () => {};
  }

  const onInternalStateChange = () => {
    listener();
  };

  const onStorage = (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key && event.key !== STORAGE_KEY) return;
    listener();
  };

  window.addEventListener(STATE_CHANGE_EVENT, onInternalStateChange);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(STATE_CHANGE_EVENT, onInternalStateChange);
    window.removeEventListener("storage", onStorage);
  };
}

const STATE_VERSION = 1;

export function exportFullProject() {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const payload = {
    version: STATE_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      activities: project.activities,
      baselines: project.baselines ?? [],
      actions: project.actions ?? [],
      setup: sanitizeProjectSetup(project.setup),
      teamMembers: sanitizeTeamMembers(project.teamMembers),
      engineDocuments: sanitizeEngineDocuments(project.engineDocuments).map((d) => ({
        ...d,
        blobId: d.blobId,
      })),
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function importProjectFromJson(jsonString) {
  try {
    const payload = JSON.parse(jsonString);
    const project = payload?.project ?? payload;
    const activities = Array.isArray(project.activities) ? project.activities : [];
    const baselines = Array.isArray(project.baselines) ? project.baselines : [];
    const actions = Array.isArray(project.actions) ? project.actions : [];
    const name = String(project?.name ?? "Imported Project").trim() || "Imported Project";
    const state = getState();
    const id = getNextProjectId(state.projects);
    const newProject = createProject(id, name, activities, baselines, actions, {
      setup: project?.setup,
      teamMembers: project?.teamMembers,
      engineDocuments: project?.engineDocuments,
    });
    state.projects.push(newProject);
    state.activeProjectId = newProject.id;
    saveState(state);
    return { success: true, project: newProject };
  } catch (error) {
    console.error("Import failed:", error);
    return { success: false, error: error.message };
  }
}
