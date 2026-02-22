import { escapeHtml, notify, showModal, triggerDownload } from "./common.js";
import {
  addProject,
  deleteProject,
  duplicateProject,
  exportFullProject,
  getActiveProject,
  getProjects,
  importProjectFromJson,
  renameProject,
  setActiveProject,
} from "./storage.js";
import { canManageProjects, getCurrentUser } from "./auth.js";
import { clearUndoStack } from "./undo.js";

const PROJECT_NAME_MAX_LENGTH = 120;

export function initializeProjectToolbar({ onProjectChange } = {}) {
  const select = document.querySelector("#project-select");
  const addButton = document.querySelector("#project-add-btn");
  const duplicateButton = document.querySelector("#project-duplicate-btn");
  const renameButton = document.querySelector("#project-rename-btn");
  const deleteButton = document.querySelector("#project-delete-btn");
  const exportButton = document.querySelector("#project-export-btn");
  const importInput = document.querySelector("#project-import-input");
  const summary = document.querySelector("#project-summary");
  const currentUser = getCurrentUser();
  const canManage = canManageProjects(currentUser);

  if (!select || !addButton || !duplicateButton || !renameButton || !deleteButton || !summary) return;

  const runChangeHandler = () => {
    if (typeof onProjectChange === "function") {
      onProjectChange();
      return;
    }
    window.location.reload();
  };

  const render = () => {
    const projects = getProjects();
    const activeProject = getActiveProject();
    select.innerHTML = projects
      .map(
        (project) =>
          `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)} (${project.activityCount} activities)</option>`,
      )
      .join("");
    select.value = activeProject.id;
    deleteButton.disabled = !canManage || projects.length <= 1;
    addButton.hidden = !canManage;
    duplicateButton.hidden = !canManage;
    renameButton.hidden = !canManage;
    deleteButton.hidden = !canManage;
    summary.textContent = `${projects.length} projects tracked | Active: ${activeProject.name} | ${activeProject.activities.length} activities`;
  };

  select.addEventListener("change", () => {
    const changed = setActiveProject(select.value);
    if (!changed) {
      notify("Unable to switch project.", "error");
      render();
      return;
    }
    clearUndoStack();
    notify("Active project switched.", "success");
    render();
    runChangeHandler();
  });

  addButton.addEventListener("click", async () => {
    if (!canManage) return;
    const projects = getProjects();
    const result = await showModal({
      title: "New Project",
      body: "Enter a name for the new project.",
      fields: [
        {
          id: "name",
          label: "Project name",
          placeholder: `Project ${projects.length + 1}`,
          value: `Project ${projects.length + 1}`,
          required: true,
          maxLength: PROJECT_NAME_MAX_LENGTH,
        },
      ],
      primaryLabel: "Create",
      secondaryLabel: "Cancel",
    });
    if (!result) return;
    const name = (result.name || "").trim();
    if (!name) {
      notify("Project name cannot be empty.", "warning");
      return;
    }
    if (name.length > PROJECT_NAME_MAX_LENGTH) {
      notify("Project name is too long.", "warning");
      return;
    }
    const created = addProject(name);
    notify(`Created project "${created.name}".`, "success");
    render();
    runChangeHandler();
  });

  duplicateButton.addEventListener("click", async () => {
    if (!canManage) return;
    const activeProject = getActiveProject();
    const result = await showModal({
      title: "Duplicate Project",
      body: `Create a copy of "${activeProject.name}" with all activities, baselines, and actions.`,
      fields: [
        {
          id: "name",
          label: "Project name",
          placeholder: `${activeProject.name} Copy`,
          value: `${activeProject.name} Copy`,
          required: true,
          maxLength: PROJECT_NAME_MAX_LENGTH,
        },
      ],
      primaryLabel: "Duplicate",
      secondaryLabel: "Cancel",
    });
    if (!result) return;
    const name = (result.name || "").trim() || `${activeProject.name} Copy`;
    const duplicated = duplicateProject(activeProject.id, name);
    if (!duplicated) {
      notify("Unable to duplicate project.", "error");
      return;
    }
    notify(`Created duplicate template "${duplicated.name}".`, "success");
    render();
    runChangeHandler();
  });

  renameButton.addEventListener("click", async () => {
    if (!canManage) return;
    const activeProject = getActiveProject();
    const result = await showModal({
      title: "Rename Project",
      body: "Enter the new name for this project.",
      fields: [
        {
          id: "name",
          label: "Project name",
          value: activeProject.name,
          required: true,
          maxLength: PROJECT_NAME_MAX_LENGTH,
        },
      ],
      primaryLabel: "Rename",
      secondaryLabel: "Cancel",
    });
    if (!result) return;
    const name = (result.name || "").trim();
    if (!name) {
      notify("Project name cannot be empty.", "warning");
      return;
    }
    const renamed = renameProject(activeProject.id, name);
    if (!renamed) {
      notify("Unable to rename project.", "error");
      return;
    }
    notify(`Renamed to "${renamed.name}".`, "success");
    render();
    runChangeHandler();
  });

  deleteButton.addEventListener("click", async () => {
    if (!canManage) return;
    const activeProject = getActiveProject();
    const result = await showModal({
      title: "Delete Project",
      body: `Permanently delete "${activeProject.name}"? This removes all activities, baselines, and actions. Type the project name below to confirm.`,
      fields: [
        {
          id: "confirm",
          label: "Type project name to confirm",
          placeholder: activeProject.name,
          required: true,
        },
      ],
      primaryLabel: "Delete",
      secondaryLabel: "Cancel",
      danger: true,
    });
    if (!result || result.confirm !== activeProject.name) {
      if (result) notify("Project name did not match. Deletion cancelled.", "warning");
      return;
    }
    const deleteResult = deleteProject(activeProject.id);
    if (!deleteResult.deleted) {
      notify(deleteResult.reason || "Project could not be deleted.", "warning");
      return;
    }
    notify("Project deleted.", "warning");
    render();
    runChangeHandler();
  });

  exportButton?.addEventListener("click", () => {
    if (!canManage) return;
    const json = exportFullProject();
    const activeProject = getActiveProject();
    const filename = `project_${activeProject.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
    triggerDownload(filename, json, "application/json;charset=utf-8;");
    notify("Project exported.", "success");
  });

  importInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file || !canManage) return;
    try {
      const text = await file.text();
      const result = importProjectFromJson(text);
      if (result.success) {
        notify(`Imported project "${result.project.name}".`, "success");
        render();
        runChangeHandler();
      } else {
        notify(`Import failed: ${result.error}`, "error");
      }
    } catch (err) {
      notify(`Import failed: ${err.message}`, "error");
    }
    e.target.value = "";
  });

  render();
}
