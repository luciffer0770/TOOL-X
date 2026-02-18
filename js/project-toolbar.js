import { notify } from "./common.js";
import { addProject, deleteProject, getActiveProject, getProjects, renameProject, setActiveProject } from "./storage.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function initializeProjectToolbar({ onProjectChange } = {}) {
  const select = document.querySelector("#project-select");
  const addButton = document.querySelector("#project-add-btn");
  const renameButton = document.querySelector("#project-rename-btn");
  const deleteButton = document.querySelector("#project-delete-btn");
  const summary = document.querySelector("#project-summary");

  if (!select || !addButton || !renameButton || !deleteButton || !summary) return;

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
    deleteButton.disabled = projects.length <= 1;
    summary.textContent = `${projects.length} projects tracked | Active: ${activeProject.name} | ${activeProject.activities.length} activities`;
  };

  select.addEventListener("change", () => {
    const changed = setActiveProject(select.value);
    if (!changed) {
      notify("Unable to switch project.", "error");
      render();
      return;
    }
    notify("Active project switched.", "success");
    render();
    runChangeHandler();
  });

  addButton.addEventListener("click", () => {
    const proposedName = prompt("Enter a name for the new project:", `Project ${getProjects().length + 1}`);
    if (proposedName === null) return;
    const created = addProject(proposedName);
    notify(`Created project "${created.name}".`, "success");
    render();
    runChangeHandler();
  });

  renameButton.addEventListener("click", () => {
    const activeProject = getActiveProject();
    const nextName = prompt("Rename active project:", activeProject.name);
    if (nextName === null) return;
    const renamed = renameProject(activeProject.id, nextName);
    if (!renamed) {
      notify("Unable to rename project.", "error");
      return;
    }
    notify(`Renamed to "${renamed.name}".`, "success");
    render();
    runChangeHandler();
  });

  deleteButton.addEventListener("click", () => {
    const activeProject = getActiveProject();
    const shouldDelete = confirm(`Delete project "${activeProject.name}"? This removes all its activities.`);
    if (!shouldDelete) return;
    const result = deleteProject(activeProject.id);
    if (!result.deleted) {
      notify(result.reason || "Project could not be deleted.", "warning");
      return;
    }
    notify("Project deleted.", "warning");
    render();
    runChangeHandler();
  });

  render();
}
