import { COLUMN_SCHEMA, generateActivityId, sanitizeActivity } from "./schema.js";

const STORAGE_KEY = "atlas_state_v1";
const STATE_CHANGE_EVENT = "atlas_state_changed";
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

function createProject(id, name, activities = [], baselines = [], actions = []) {
  const normalizedBaselines = baselines.map((baseline, index) =>
    sanitizeBaseline(baseline, `Baseline v${index + 1}`),
  );
  const normalizedActions = actions.map((action) => sanitizeAction(action));
  return {
    id,
    name,
    activities: activities.map((activity) => sanitizeActivity(activity)),
    baselines: normalizedBaselines,
    actions: normalizedActions,
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return baseState();
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
      normalizedProjects.push(createProject(id, name, rawActivities, rawBaselines, rawActions));
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

  return {
    projects: normalizedProjects,
    activeProjectId,
    settings,
  };
}

function writeState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

/** Keys used by this app in localStorage. Used for reset. */
export const APP_STORAGE_KEYS = [
  "atlas_state_v1",
  "atlas_auth_v1",
  "atlas_undo_v1",
  "atlas_theme",
];

const LEGACY_KEYS = [
  "industrial_planning_intelligence_state_v1",
  "industrial_planning_auth_session_v1",
  "industrial_planning_undo_stack_v1",
  "industrial_planning_theme",
];

export function resetApplicationData() {
  [...APP_STORAGE_KEYS, ...LEGACY_KEYS].forEach((key) => localStorage.removeItem(key));
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
  saveState(state);
}

export function clearAllActivities() {
  const state = getState();
  const project = getActiveProjectRecord(state);
  project.activities = [];
  saveState(state);
}

export function addActivity(activity) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const sanitized = sanitizeActivity(activity);
  sanitized.activityId = ensureUniqueActivityId(project.activities, sanitized.activityId);
  project.activities.push(sanitized);
  saveState(state);
  return sanitized;
}

export function insertActivityAt(index, activity) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  const sanitized = sanitizeActivity(activity);
  sanitized.activityId = ensureUniqueActivityId(project.activities, sanitized.activityId);
  const clampedIndex = Math.max(0, Math.min(Number.isFinite(Number(index)) ? Number(index) : 0, project.activities.length));
  project.activities.splice(clampedIndex, 0, sanitized);
  saveState(state);
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
  saveState(state);
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
  saveState(state);
  return updated;
}

export function deleteActivity(activityId) {
  const state = getState();
  const project = getActiveProjectRecord(state);
  project.activities = project.activities.filter((activity) => activity.activityId !== activityId);
  saveState(state);
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
    const newProject = createProject(id, name, activities, baselines, actions);
    state.projects.push(newProject);
    state.activeProjectId = newProject.id;
    saveState(state);
    return { success: true, project: newProject };
  } catch (error) {
    console.error("Import failed:", error);
    return { success: false, error: error.message };
  }
}
