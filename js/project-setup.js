import { escapeHtml, notify, setActiveNavigation } from "./common.js";
import { initPage } from "./page-init.js";
import {
  getActiveProject,
  getDefaultEditor,
  replaceActiveTeamMembers,
  setActiveProjectDisplayName,
  setDefaultEditor,
  updateActiveProjectSetup,
} from "./storage.js";
import { canManageProjects } from "./auth.js";

const SETUP_KEYS = [
  "projectCode",
  "customerOem",
  "engineType",
  "engineSerialNo",
  "trolleyCode",
  "trolleyLocation",
  "projectManager",
  "plannedStartDate",
  "targetFinishDate",
  "contractReference",
  "workingHoursPerDay",
  "warningThresholdDays",
  "criticalThresholdDays",
];

let currentUser = null;
let teamDraft = [];

function canEdit() {
  return canManageProjects(currentUser);
}

function applyRoleReadonly() {
  const tech = currentUser?.role === "technician";
  document.querySelectorAll(".ps-input-primary, #ps-project-name, #ps-default-editor").forEach((el) => {
    el.readOnly = tech || !canEdit();
    el.classList.toggle("is-readonly", tech || !canEdit());
  });
  document.querySelectorAll("#ps-team-body input, #ps-team-body select").forEach((el) => {
    el.readOnly = tech || !canEdit();
    el.disabled = tech || !canEdit();
  });
}

function loadForm() {
  const p = getActiveProject();
  const nameEl = document.querySelector("#ps-project-name");
  if (nameEl) nameEl.value = p.name || "";
  const s = p.setup || {};
  SETUP_KEYS.forEach((key) => {
    const el = document.querySelector(`[data-ps="${key}"]`);
    if (!el) return;
    const v = s[key];
    el.value = v !== undefined && v !== null ? String(v) : "";
  });
  teamDraft = (p.teamMembers || []).map((m) => ({ ...m }));
  renderTeam();
  const defEd = document.querySelector("#ps-default-editor");
  if (defEd) defEd.value = getDefaultEditor();
  applyRoleReadonly();
  const status = document.querySelector("#ps-save-status");
  if (status) status.textContent = "";
}

function gatherSetup() {
  const o = {};
  SETUP_KEYS.forEach((key) => {
    const el = document.querySelector(`[data-ps="${key}"]`);
    if (!el) return;
    o[key] = el.value;
  });
  return o;
}

function renderTeam() {
  const body = document.querySelector("#ps-team-body");
  if (!body) return;
  if (!teamDraft.length) {
    body.innerHTML = `<tr class="ps-team-empty"><td colspan="8"><span class="text-muted">No team members yet. Use “Add team member” to begin.</span></td></tr>`;
    return;
  }
  body.innerHTML = teamDraft
    .map((m, i) => {
      const ro = !canEdit() || currentUser?.role === "technician";
      const dis = ro ? "disabled" : "";
      return `
      <tr data-index="${i}">
        <td><input type="text" class="ps-team-input" data-f="name" value="${escapeHtml(m.name)}" ${dis} /></td>
        <td><input type="text" class="ps-team-input" data-f="role" value="${escapeHtml(m.role)}" ${dis} /></td>
        <td><input type="text" class="ps-team-input" data-f="department" value="${escapeHtml(m.department)}" ${dis} /></td>
        <td><input type="email" class="ps-team-input" data-f="email" value="${escapeHtml(m.email)}" ${dis} /></td>
        <td><input type="text" class="ps-team-input" data-f="phone" value="${escapeHtml(m.phone)}" ${dis} /></td>
        <td>
          <select class="ps-team-input" data-f="accessLevel" ${dis}>
            ${["Standard", "Elevated", "Admin", "Read-only"]
              .map((opt) => {
                const sel = (m.accessLevel || "Standard") === opt ? "selected" : "";
                return `<option value="${escapeHtml(opt)}" ${sel}>${escapeHtml(opt)}</option>`;
              })
              .join("")}
          </select>
        </td>
        <td><input type="text" class="ps-team-input" data-f="notes" value="${escapeHtml(m.notes)}" ${dis} /></td>
        <td data-role-hide="technician">${ro ? "" : `<button type="button" class="ghost ps-team-remove" data-i="${i}">Remove</button>`}</td>
      </tr>`;
    })
    .join("");

  body.querySelectorAll(".ps-team-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      teamDraft.splice(i, 1);
      renderTeam();
    });
  });

  body.querySelectorAll(".ps-team-input").forEach((input) => {
    input.addEventListener("change", () => {
      const tr = input.closest("tr");
      const idx = Number(tr?.dataset.index);
      if (Number.isNaN(idx) || !teamDraft[idx]) return;
      const f = input.dataset.f;
      if (f) teamDraft[idx][f] = input.value;
    });
  });
}

function syncTeamFromDom() {
  document.querySelectorAll("#ps-team-body tr[data-index]").forEach((tr) => {
    const idx = Number(tr.dataset.index);
    if (Number.isNaN(idx) || !teamDraft[idx]) return;
    tr.querySelectorAll(".ps-team-input").forEach((input) => {
      const f = input.dataset.f;
      if (f) teamDraft[idx][f] = input.value;
    });
  });
}

function initialize() {
  setActiveNavigation();

  document.querySelector("#ps-save-btn")?.addEventListener("click", () => {
    if (!canEdit()) return;
    const name = document.querySelector("#ps-project-name")?.value.trim();
    if (name) setActiveProjectDisplayName(name);
    updateActiveProjectSetup(gatherSetup());
    const st = document.querySelector("#ps-save-status");
    if (st) st.textContent = "Saved · " + new Date().toLocaleTimeString();
    notify("Project setup saved.", "success");
  });

  document.querySelector("#ps-team-add")?.addEventListener("click", () => {
    if (!canEdit()) return;
    syncTeamFromDom();
    teamDraft.push({
      id: `TM-${Date.now()}`,
      name: "",
      role: "",
      department: "",
      email: "",
      phone: "",
      accessLevel: "Standard",
      notes: "",
    });
    renderTeam();
  });

  document.querySelector("#ps-team-save")?.addEventListener("click", () => {
    if (!canEdit()) return;
    syncTeamFromDom();
    replaceActiveTeamMembers(teamDraft);
    notify("Team roster saved.", "success");
  });

  document.querySelector("#ps-prefs-save")?.addEventListener("click", () => {
    if (!canEdit()) return;
    const v = document.querySelector("#ps-default-editor")?.value?.trim() || "Planner";
    setDefaultEditor(v);
    notify("Workspace preferences saved.", "success");
  });

  initPage({
    requireAuth: true,
    projectToolbarMode: "full",
    onReady(user) {
      currentUser = user;
      if (!currentUser) return;
      loadForm();
    },
    onProjectChange() {
      loadForm();
    },
    onStateChange() {
      loadForm();
    },
  }).catch((e) => console.error("[project-setup]", e));
}

initialize();
