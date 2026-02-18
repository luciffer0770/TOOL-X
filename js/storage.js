import { COLUMN_SCHEMA, generateActivityId, sanitizeActivity } from "./schema.js";

const STORAGE_KEY = "industrial_planning_intelligence_state_v1";

function baseState() {
  const defaultVisibility = {};
  COLUMN_SCHEMA.forEach((column) => {
    defaultVisibility[column.key] = true;
  });

  return {
    activities: [],
    settings: {
      tableColumnVisibility: defaultVisibility,
      defaultEditor: "Planner",
    },
  };
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
  const normalized = baseState();
  if (Array.isArray(state.activities)) {
    normalized.activities = state.activities.map((activity) => sanitizeActivity(activity));
  }
  normalized.settings = {
    ...normalized.settings,
    ...(state.settings ?? {}),
  };

  normalized.settings.tableColumnVisibility = {
    ...baseState().settings.tableColumnVisibility,
    ...(state.settings?.tableColumnVisibility ?? {}),
  };
  return normalized;
}

function writeState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getState() {
  return normalizeState(readRawState());
}

export function saveState(nextState) {
  writeState(normalizeState(nextState));
}

export function getActivities() {
  return getState().activities;
}

export function saveActivities(activities) {
  const state = getState();
  state.activities = activities.map((activity) => sanitizeActivity(activity));
  saveState(state);
}

export function clearAllActivities() {
  const state = getState();
  state.activities = [];
  saveState(state);
}

export function addActivity(activity) {
  const state = getState();
  const sanitized = sanitizeActivity(activity);
  const existingIds = new Set(state.activities.map((entry) => entry.activityId));
  if (!sanitized.activityId || existingIds.has(sanitized.activityId)) {
    sanitized.activityId = generateActivityId(state.activities);
  }
  state.activities.push(sanitized);
  saveState(state);
  return sanitized;
}

export function upsertActivities(incomingActivities) {
  const state = getState();
  const byId = new Map(state.activities.map((activity) => [activity.activityId, activity]));
  incomingActivities.forEach((incoming) => {
    const sanitized = sanitizeActivity(incoming);
    if (!sanitized.activityId) {
      sanitized.activityId = generateActivityId([...byId.values()]);
    }
    byId.set(sanitized.activityId, { ...byId.get(sanitized.activityId), ...sanitized });
  });
  state.activities = [...byId.values()].map((activity) => sanitizeActivity(activity));
  saveState(state);
  return state.activities;
}

export function updateActivity(activityId, patch) {
  const state = getState();
  const index = state.activities.findIndex((activity) => activity.activityId === activityId);
  if (index === -1) return null;
  const existing = state.activities[index];
  const updated = sanitizeActivity({
    ...existing,
    ...patch,
    lastModifiedDate: patch.lastModifiedDate ?? new Date().toISOString().slice(0, 10),
  });
  state.activities[index] = updated;
  saveState(state);
  return updated;
}

export function deleteActivity(activityId) {
  const state = getState();
  state.activities = state.activities.filter((activity) => activity.activityId !== activityId);
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
