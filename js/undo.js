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
  // New user action invalidates the redo stack (redo is in-memory only)
  redoStack.length = 0;
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
  // Capture current state as a redo snapshot before reverting
  const currentSnapshot = {
    projectId: project.id,
    activities: project.activities.map((a) => ({ ...a })),
    baselines: (project.baselines ?? []).map((b) => ({ ...b })),
    actions: (project.actions ?? []).map((a) => ({ ...a })),
    description: `Redo snapshot (${new Date().toISOString()})`,
    at: new Date().toISOString(),
  };
  // push onto redo stack (in-memory)
  redoStack.push(currentSnapshot);

  // apply the undo snapshot
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

// In-memory redo stack (transient, cleared on reload)
const redoStack = [];

export function canRedo() {
  const state = getState();
  if (!redoStack.length) return false;
  const top = redoStack[redoStack.length - 1];
  return top && top.projectId === state.activeProjectId;
}

export function getRedoDescription() {
  if (!redoStack.length) return null;
  return redoStack[redoStack.length - 1].description;
}

export function redo() {
  const state = getState();
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  if (!project) return { ok: false, reason: "Project not found" };
  if (!redoStack.length) return { ok: false, reason: "Nothing to redo" };
  const next = redoStack[redoStack.length - 1];
  if (next.projectId !== state.activeProjectId) return { ok: false, reason: "Project changed" };

  // capture current state as an undo snapshot so redo can be undone
  const undoSnapshot = {
    projectId: project.id,
    activities: project.activities.map((a) => ({ ...a })),
    baselines: (project.baselines ?? []).map((b) => ({ ...b })),
    actions: (project.actions ?? []).map((a) => ({ ...a })),
    description: `Undo snapshot (${new Date().toISOString()})`,
    at: new Date().toISOString(),
  };
  const stack = getUndoStack();
  stack.push(undoSnapshot);
  setUndoStack(stack);

  // apply redo snapshot
  project.activities = next.activities.map((a) => ({ ...a }));
  project.baselines = next.baselines ?? [];
  project.actions = next.actions ?? [];
  // pop redo
  redoStack.pop();
  saveState(state);
  return { ok: true, description: next.description };
}
