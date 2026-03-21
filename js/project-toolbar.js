import { escapeHtml, notify, showLoading, showModal, triggerDownload } from "./common.js";
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
import { canManageProjects, getAuthBearerHeaders, getCurrentUser } from "./auth.js";

async function hasBackend() {
  try {
    const r = await fetch("/api/health");
    return r.ok;
  } catch {
    return false;
  }
}

const PROJECT_NAME_MAX_LENGTH = 120;

/**
 * @param {object} opts
 * @param {() => void} [opts.onProjectChange]
 * @param {"full" | "switcher"} [opts.mode] full = Project Setup hub only; switcher = active project + link
 */
export function initializeProjectToolbar({ onProjectChange, mode = "switcher" } = {}) {
  let attempts = 0;
  const maxAttempts = 8;
  let projectFilterText = "";

  async function tryInit() {
    attempts++;
    const select = document.querySelector("#project-select");
    const summary = document.querySelector("#project-summary");
    const currentUser = getCurrentUser();
    const canManage = canManageProjects(currentUser);
    const isFull = mode === "full";

    const addButton = document.querySelector("#project-add-btn");
    const duplicateButton = document.querySelector("#project-duplicate-btn");
    const renameButton = document.querySelector("#project-rename-btn");
    const deleteButton = document.querySelector("#project-delete-btn");
    const exportButton = document.querySelector("#project-export-btn");
    const importInput = document.querySelector("#project-import-input");
    const rowActions = document.querySelector(".project-toolbar .row-actions");

    if (!select) {
      if (attempts < maxAttempts) {
        setTimeout(tryInit, 200);
        return;
      }
      console.warn("[project-toolbar] no #project-select");
      return;
    }

    if (isFull) {
      if (!addButton || !duplicateButton || !renameButton || !deleteButton || !summary) {
        if (attempts < maxAttempts) {
          setTimeout(tryInit, 200);
          return;
        }
        console.warn("[project-toolbar] full mode missing controls");
        return;
      }
    }

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
      const q = projectFilterText.trim().toLowerCase();
      const filtered = projects.filter(
        (p) =>
          p.id === activeProject.id ||
          !q ||
          String(p.name || "")
            .toLowerCase()
            .includes(q) ||
          String(p.id || "")
            .toLowerCase()
            .includes(q),
      );

      select.innerHTML = filtered
        .map(
          (project) =>
            `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)} (${project.activityCount} activities)</option>`,
        )
        .join("");
      select.value = activeProject.id;

      if (isFull) {
        deleteButton.disabled = !canManage || projects.length <= 1;
        addButton.hidden = !canManage;
        duplicateButton.hidden = !canManage;
        renameButton.hidden = !canManage;
        deleteButton.hidden = !canManage;
        summary.textContent = `${projects.length} projects · Active: ${activeProject.name} · ${activeProject.activities.length} activities`;
      } else if (summary) {
        summary.textContent = `${projects.length} projects · ${activeProject.activities.length} activities in view`;
      }
    };

    select.addEventListener("change", () => {
      const changed = setActiveProject(select.value);
      if (!changed) {
        notify("Unable to switch project.", "error");
        render();
        return;
      }
      notify("Active project updated.", "success");
      render();
      runChangeHandler();
    });

    if (isFull) {
      const filterInput = document.querySelector("#project-list-filter");
      filterInput?.addEventListener("input", () => {
        projectFilterText = filterInput.value || "";
        render();
      });

      addButton.addEventListener("click", async () => {
        if (!canManage) return;
        const projects = getProjects();
        const result = await showModal({
          title: "New project",
          body: "Projects are created here so every sheet stays focused on delivery. Enter a display name.",
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
          notify("Name cannot be empty.", "warning");
          return;
        }
        if (name.length > PROJECT_NAME_MAX_LENGTH) {
          notify("Name is too long.", "warning");
          return;
        }
        const created = addProject(name);
        notify(`Created "${created.name}".`, "success");
        render();
        runChangeHandler();
      });

      duplicateButton.addEventListener("click", async () => {
        if (!canManage) return;
        const active = getActiveProject();
        const result = await showModal({
          title: "Duplicate project",
          body: `Copy "${active.name}" including activities, baselines, and actions.`,
          fields: [
            {
              id: "name",
              label: "New project name",
              placeholder: `${active.name} Copy`,
              value: `${active.name} Copy`,
              required: true,
              maxLength: PROJECT_NAME_MAX_LENGTH,
            },
          ],
          primaryLabel: "Duplicate",
          secondaryLabel: "Cancel",
        });
        if (!result) return;
        const name = (result.name || "").trim() || `${active.name} Copy`;
        const duplicated = duplicateProject(active.id, name);
        if (!duplicated) {
          notify("Unable to duplicate.", "error");
          return;
        }
        notify(`Created "${duplicated.name}".`, "success");
        render();
        runChangeHandler();
      });

      renameButton.addEventListener("click", async () => {
        if (!canManage) return;
        const active = getActiveProject();
        const result = await showModal({
          title: "Rename project",
          body: "Updates the name everywhere this project appears.",
          fields: [
            {
              id: "name",
              label: "Project name",
              value: active.name,
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
          notify("Name cannot be empty.", "warning");
          return;
        }
        const renamed = renameProject(active.id, name);
        if (!renamed) {
          notify("Unable to rename.", "error");
          return;
        }
        notify(`Renamed to "${renamed.name}".`, "success");
        render();
        runChangeHandler();
      });

      deleteButton.addEventListener("click", async () => {
        if (!canManage) return;
        const active = getActiveProject();
        const result = await showModal({
          title: "Delete project",
          body: `Permanently delete "${active.name}"? Type the project name to confirm.`,
          fields: [
            {
              id: "confirm",
              label: "Type project name to confirm",
              placeholder: active.name,
              required: true,
            },
          ],
          primaryLabel: "Delete",
          secondaryLabel: "Cancel",
          danger: true,
        });
        if (!result || result.confirm !== active.name) {
          if (result) notify("Name did not match. Cancelled.", "warning");
          return;
        }
        const deleteResult = deleteProject(active.id);
        if (!deleteResult.deleted) {
          notify(deleteResult.reason || "Could not delete.", "warning");
          return;
        }
        notify("Project deleted.", "warning");
        render();
        runChangeHandler();
      });

      exportButton?.addEventListener("click", () => {
        if (!canManage) return;
        const json = exportFullProject();
        const active = getActiveProject();
        const filename = `project_${active.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
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
            notify(`Imported "${result.project.name}".`, "success");
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

      if (rowActions && canManage) {
        const backendAvailable = await hasBackend();
        if (backendAvailable) {
          const backupBtn = document.createElement("button");
          backupBtn.className = "ghost";
          backupBtn.type = "button";
          backupBtn.textContent = "Backup database";
          backupBtn.title = "Download SQLite backup";
          backupBtn.addEventListener("click", async () => {
            const hideLoading = showLoading("Preparing backup...");
            try {
              const r = await fetch("/api/backup", { headers: { ...getAuthBearerHeaders() } });
              if (!r.ok) throw new Error("Backup failed");
              const blob = await r.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `atlas_backup_${new Date().toISOString().slice(0, 10)}.db`;
              a.click();
              URL.revokeObjectURL(url);
              notify("Backup downloaded.", "success");
            } catch (e) {
              notify("Backup failed: " + (e.message || "Unknown"), "error");
            } finally {
              hideLoading();
            }
          });
          rowActions.appendChild(backupBtn);

          const restoreLabel = document.createElement("label");
          restoreLabel.className = "ghost label-as-button";
          restoreLabel.innerHTML = 'Restore database <input id="project-restore-input" type="file" accept=".db" hidden />';
          const restoreInput = restoreLabel.querySelector("input");
          restoreInput?.addEventListener("change", async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const result = await showModal({
              title: "Restore database",
              body: "Replace all data with this backup?",
              primaryLabel: "Restore",
              secondaryLabel: "Cancel",
              danger: true,
            });
            if (!result) {
              e.target.value = "";
              return;
            }
            const hideLoading = showLoading("Restoring...");
            try {
              const form = new FormData();
              form.append("file", file);
              const r = await fetch("/api/restore", {
                method: "POST",
                headers: { ...getAuthBearerHeaders() },
                body: form,
              });
              const data = await r.json();
              if (data?.ok) {
                notify("Restored. Reloading…", "success");
                setTimeout(() => location.reload(), 800);
              } else {
                notify("Restore failed: " + (data?.error || "Unknown"), "error");
              }
            } catch (err) {
              notify("Restore failed: " + err.message, "error");
            } finally {
              hideLoading();
              e.target.value = "";
            }
          });
          rowActions.appendChild(restoreLabel);
        }
      }
    }

    render();
  }

  tryInit();
}
