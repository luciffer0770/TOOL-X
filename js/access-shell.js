import { getRoleBadgeClass, getRoleLabel, getDefaultHomeForRole, logout, requireAuthenticatedUser } from "./auth.js";

const NAV_HIDDEN_BY_ROLE = {
  technician: new Set(["gantt.html", "materials.html"]),
};

function parseRoleList(attributeValue) {
  return String(attributeValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function applyRoleVisibility(role) {
  document.querySelectorAll("[data-role-hide]").forEach((node) => {
    const hiddenRoles = parseRoleList(node.getAttribute("data-role-hide"));
    node.hidden = hiddenRoles.includes(role);
  });

  document.querySelectorAll("[data-role-show]").forEach((node) => {
    const shownRoles = parseRoleList(node.getAttribute("data-role-show"));
    node.hidden = shownRoles.length > 0 && !shownRoles.includes(role);
  });
}

function applyRoleNavigation(role) {
  const hiddenSet = NAV_HIDDEN_BY_ROLE[role] ?? new Set();
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    link.hidden = hiddenSet.has(href);
  });
}

function renderSession(user) {
  const roleBadge = document.querySelector("#user-role-badge");
  const userName = document.querySelector("#user-display-name");
  const logoutButton = document.querySelector("#logout-btn");

  if (roleBadge) {
    roleBadge.className = getRoleBadgeClass(user);
    roleBadge.textContent = getRoleLabel(user);
  }
  if (userName) {
    userName.textContent = user.displayName || user.username;
  }
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      logout();
      location.href = "login.html";
    });
  }
}

export function initializeAccessShell({ allowedRoles = [] } = {}) {
  const user = requireAuthenticatedUser({ allowedRoles });
  if (!user) return null;
  renderSession(user);
  applyRoleVisibility(user.role);
  applyRoleNavigation(user.role);
  return user;
}

export function goToRoleHome(user) {
  const page = getDefaultHomeForRole(user);
  location.href = page;
}
