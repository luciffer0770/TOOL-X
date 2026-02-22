/**
 * Undo stack for activity operations. Stores snapshots before destructive changes.
 */
import { getState, saveState } from "./storage.js";

const UNDO_STACK_KEY = "industrial_planning_undo_stack_v1";
const MAX_UNDO_DEPTH = 20;

function getUndoStack() {
  try {
    const raw = localStorage.getItem(UNDO_STACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setUndoStack(stack) {
  localStorage.setItem(UNDO_STACK_KEY, JSON.stringify(stack.slice(-MAX_UNDO_DEPTH)));
}

export function clearUndoStack() {
  setUndoStack([]);
}

export function pushUndoSnapshot(description) {
  const state = getState();
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  if (!project) return;
  const snapshot = {
    projectId: project.id,
    activities: project.activities.map((a) => ({ ...a })),
    baselines: (project.baselines ?? []).map((b) => ({ ...b })),
    actions: (project.actions ?? []).map((a) => ({ ...a })),
    description,
    at: new Date().toISOString(),
  };
  const stack = getUndoStack();
  stack.push(snapshot);
  setUndoStack(stack);
}

export function canUndo() {
  const state = getState();
  const stack = getUndoStack();
  return stack.length > 0 && stack[stack.length - 1].projectId === state.activeProjectId;
}

export function undo() {
  const state = getState();
  const stack = getUndoStack();
  if (!stack.length) return { ok: false, reason: "Nothing to undo" };
  const last = stack[stack.length - 1];
  if (last.projectId !== state.activeProjectId) return { ok: false, reason: "Project changed" };
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  if (!project) return { ok: false, reason: "Project not found" };
  project.activities = last.activities.map((a) => ({ ...a }));
  project.baselines = last.baselines ?? [];
  project.actions = last.actions ?? [];
  stack.pop();
  setUndoStack(stack);
  saveState(state);
  return { ok: true, description: last.description };
}

export function getUndoDescription() {
  const stack = getUndoStack();
  if (!stack.length) return null;
  return stack[stack.length - 1].description;
}
