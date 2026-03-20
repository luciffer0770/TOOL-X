/**
 * Project Setup page – project onboarding and configuration.
 * Replaces Settings; provides PROJECT INFORMATION and TEAM MEMBERS.
 */
import { initPage } from "./page-init.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { setActiveNavigation } from "./common.js";
import {
  getActiveProject,
  saveProjectConfig,
  getTeamMembers,
  addTeamMember,
  updateTeamMember,
  removeTeamMember,
} from "./storage.js";
import { notify, showModal, escapeHtml } from "./common.js";

const CONFIG_IDS = [
  "projectCode",
  "projectName",
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

function loadConfigIntoForm() {
  const project = getActiveProject();
  const config = project.projectConfig || {};
  CONFIG_IDS.forEach((key) => {
    const el = document.getElementById(`config-${key}`);
    if (!el) return;
    const val = config[key];
    if (val !== undefined && val !== null) {
      el.value = val;
    }
  });
  // Sync project name from project if config empty
  const nameEl = document.getElementById("config-projectName");
  if (nameEl && !config.projectName && project.name) {
    nameEl.value = project.name;
  }
  const codeEl = document.getElementById("config-projectCode");
  if (codeEl && !config.projectCode && project.id) {
    codeEl.value = project.id;
  }
}

function saveConfigFromForm() {
  const config = {};
  CONFIG_IDS.forEach((key) => {
    const el = document.getElementById(`config-${key}`);
    if (!el) return;
    let val = el.value;
    if (key === "workingHoursPerDay" || key === "warningThresholdDays" || key === "criticalThresholdDays") {
      val = Number(val) || (key === "workingHoursPerDay" ? 8 : key === "warningThresholdDays" ? 14 : 7);
    }
    config[key] = val;
  });
  saveProjectConfig(config);
  notify("Project configuration saved.", "success");
}

function renderTeamMembers() {
  const tbody = document.getElementById("team-members-body");
  if (!tbody) return;
  const members = getTeamMembers();
  if (!members.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">No team members yet. Click "Add Team Member" to add.</td>
      </tr>
    `;
    return;
  }
  tbody.innerHTML = members
    .map(
      (m) => `
    <tr data-member-id="${escapeHtml(m.id)}">
      <td><input type="text" value="${escapeHtml(m.name)}" data-field="name" placeholder="Name" /></td>
      <td><input type="text" value="${escapeHtml(m.role)}" data-field="role" placeholder="Role" /></td>
      <td><input type="text" value="${escapeHtml(m.department)}" data-field="department" placeholder="Department" /></td>
      <td><input type="email" value="${escapeHtml(m.email)}" data-field="email" placeholder="Email" /></td>
      <td><input type="tel" value="${escapeHtml(m.phone)}" data-field="phone" placeholder="Phone" /></td>
      <td><input type="text" value="${escapeHtml(m.accessLevel)}" data-field="accessLevel" placeholder="Access" /></td>
      <td><input type="text" value="${escapeHtml(m.notes)}" data-field="notes" placeholder="Notes" /></td>
      <td class="cell-actions">
        <button type="button" class="ghost team-member-save" title="Save">Save</button>
        <button type="button" class="ghost team-member-remove danger" title="Remove">Remove</button>
      </td>
    </tr>
  `,
    )
    .join("");

  tbody.querySelectorAll("tr[data-member-id]").forEach((row) => {
    const id = row.getAttribute("data-member-id");
    row.querySelectorAll("input[data-field]").forEach((input) => {
      input.addEventListener("change", () => {
        const field = input.getAttribute("data-field");
        const updates = { [field]: input.value };
        updateTeamMember(id, updates);
        notify("Team member updated.", "success");
      });
    });
    row.querySelector(".team-member-save")?.addEventListener("click", () => {
      const updates = {};
      row.querySelectorAll("input[data-field]").forEach((inp) => {
        updates[inp.getAttribute("data-field")] = inp.value;
      });
      updateTeamMember(id, updates);
      notify("Team member saved.", "success");
    });
    row.querySelector(".team-member-remove")?.addEventListener("click", async () => {
      const result = await showModal({
        title: "Remove Team Member",
        body: "Remove this team member from the project?",
        primaryLabel: "Remove",
        secondaryLabel: "Cancel",
        danger: true,
      });
      if (result && removeTeamMember(id)) {
        renderTeamMembers();
        notify("Team member removed.", "info");
      }
    });
  });
}

async function showAddTeamMemberModal() {
  const result = await showModal({
    title: "Add Team Member",
    body: "Enter the team member details.",
    fields: [
      { id: "name", label: "Name", required: true },
      { id: "role", label: "Role" },
      { id: "department", label: "Department" },
      { id: "email", label: "Email" },
      { id: "phone", label: "Phone" },
      { id: "accessLevel", label: "Access Level" },
      { id: "notes", label: "Notes" },
    ],
    primaryLabel: "Add",
    secondaryLabel: "Cancel",
  });
  if (!result) return;
  addTeamMember({
    name: (result.name || "").trim(),
    role: (result.role || "").trim(),
    department: (result.department || "").trim(),
    email: (result.email || "").trim(),
    phone: (result.phone || "").trim(),
    accessLevel: (result.accessLevel || "").trim(),
    notes: (result.notes || "").trim(),
  });
  renderTeamMembers();
  notify("Team member added.", "success");
}

function init() {
  initPage({
    requireAuth: true,
    onProjectChange: refresh,
    onReady() {
      setActiveNavigation();
      initializeProjectToolbar({ onProjectChange: refresh });
      loadConfigIntoForm();
      renderTeamMembers();

      document.getElementById("project-config-save-btn")?.addEventListener("click", () => {
        saveConfigFromForm();
      });
      document.getElementById("team-member-add-btn")?.addEventListener("click", showAddTeamMemberModal);
    },
    onStateChange: refresh,
  });
}

function refresh() {
  loadConfigIntoForm();
  renderTeamMembers();
}

init();
