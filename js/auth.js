const AUTH_STORAGE_KEY = "atlas_auth_v1";
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
const REMEMBER_ME_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const DEFAULT_USERS = [
  {
    username: "planner",
    password: "planner123",
    displayName: "Planner",
    role: "planner",
  },
  {
    username: "management",
    password: "management123",
    displayName: "Management",
    role: "management",
  },
  {
    username: "technician",
    password: "technician123",
    displayName: "Technician",
    role: "technician",
  },
];

const ROLE_LABELS = {
  planner: "Planner",
  management: "Management",
  technician: "Execution",
};

const ROLE_BADGE_CLASS = {
  planner: "badge badge-medium",
  management: "badge badge-good",
  technician: "badge badge-neutral",
};

function toRole(roleOrUser) {
  if (!roleOrUser) return "";
  if (typeof roleOrUser === "string") return roleOrUser;
  return roleOrUser.role || "";
}

function sanitizeSession(user, rememberMe = false) {
  if (!user) return null;
  const now = Date.now();
  const expiresAt = rememberMe ? now + REMEMBER_ME_TIMEOUT_MS : now + SESSION_TIMEOUT_MS;
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    loginAt: new Date().toISOString(),
    expiresAt,
    rememberMe: Boolean(rememberMe),
  };
}

function readSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.username || !parsed?.role) return null;
    const expiresAt = parsed.expiresAt;
    if (expiresAt && Date.now() > expiresAt) {
      writeSession(null);
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("Failed to parse auth session", error);
    return null;
  }
}

function writeSession(session) {
  if (!session) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function getRoleLabel(roleOrUser) {
  const role = toRole(roleOrUser);
  return ROLE_LABELS[role] || "User";
}

export function getRoleBadgeClass(roleOrUser) {
  const role = toRole(roleOrUser);
  return ROLE_BADGE_CLASS[role] || "badge badge-neutral";
}

export function listDemoUsers() {
  return DEFAULT_USERS.map((user) => ({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  }));
}

export function getCurrentUser() {
  return readSession();
}

export function login(username, password, rememberMe = false) {
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  const user = DEFAULT_USERS.find(
    (entry) => entry.username.toLowerCase() === normalizedUsername && entry.password === String(password ?? ""),
  );
  if (!user) return null;
  const session = sanitizeSession(user, rememberMe);
  writeSession(session);
  return session;
}

export function getDemoPassword(username) {
  const u = DEFAULT_USERS.find((entry) => entry.username.toLowerCase() === String(username ?? "").toLowerCase());
  return u?.password ?? "";
}

export function logout() {
  writeSession(null);
}

export function isAllowedRole(roleOrUser, allowedRoles = []) {
  if (!allowedRoles.length) return true;
  const role = toRole(roleOrUser);
  return allowedRoles.includes(role);
}

function currentPageName() {
  return location.pathname.split("/").pop() || "index.html";
}

export function toAppUrl(page) {
  const path = location.pathname;
  const dir = path.replace(/\/[^/]*$/, "/");
  return location.origin + dir + page;
}

function redirectToLogin() {
  const page = currentPageName();
  const next = encodeURIComponent(page);
  location.replace(toAppUrl(`login.html?next=${next}`));
}

export function getDefaultHomeForRole(roleOrUser) {
  const role = toRole(roleOrUser);
  if (role === "technician") return "activities.html";
  return "index.html";
}

function isDevBypass() {
  try {
    return new URLSearchParams(location.search).get("dev") === "1";
  } catch {
    return false;
  }
}

export function requireAuthenticatedUser({ allowedRoles = [] } = {}) {
  let user = getCurrentUser();
  if (!user && isDevBypass()) {
    user = login("planner", "planner123");
  }
  if (!user) {
    redirectToLogin();
    return null;
  }
  if (!isAllowedRole(user, allowedRoles)) {
    location.replace(toAppUrl(getDefaultHomeForRole(user)));
    return null;
  }
  return user;
}

export function canManageProjects(roleOrUser) {
  const role = toRole(roleOrUser);
  return role === "planner" || role === "management";
}

export function canModifyActivityStructure(roleOrUser) {
  const role = toRole(roleOrUser);
  return role === "planner" || role === "management" || role === "technician";
}

export function canImportExportData(roleOrUser) {
  return canManageProjects(roleOrUser);
}

export function canEditActivityField(roleOrUser, field) {
  const role = toRole(roleOrUser);
  if (role === "technician") {
    const executionFields = new Set([
      "actualStartDate",
      "actualEndDate",
      "actualDurationHours",
      "activityStatus",
      "completionPercentage",
      "delayReason",
      "manualOverrideDuration",
      "overrideReason",
      "remarks",
    ]);
    return executionFields.has(field);
  }
  return true;
}

export function canRunOptimization(roleOrUser) {
  const role = toRole(roleOrUser);
  return role === "planner" || role === "management";
}
