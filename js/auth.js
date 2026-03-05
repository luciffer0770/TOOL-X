const AUTH_STORAGE_KEY = "industrial_planning_auth_session_v1";
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

async function loginViaBackend(username, password, rememberMe) {
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, rememberMe }),
    });
    const data = await r.json();
    if (data?.ok && data?.user) {
      const session = {
        ...sanitizeSession(data.user, rememberMe),
        token: data.token,
        expiresAt: new Date(data.expiresAt).getTime(),
      };
      writeSession(session);
      return session;
    }
  } catch (_) {}
  return null;
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

export async function login(username, password, rememberMe = false) {
  const normalizedUsername = String(username ?? "").trim().toLowerCase();
  const pw = String(password ?? "");
  try {
    const health = await fetch("/api/health");
    if (health.ok) {
      const session = await loginViaBackend(normalizedUsername, pw, rememberMe);
      if (session) return session;
    }
  } catch (_) {}
  const user = DEFAULT_USERS.find(
    (entry) => entry.username.toLowerCase() === normalizedUsername && entry.password === pw,
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

export async function logout() {
  const session = readSession();
  if (session?.token) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.token}` },
        body: JSON.stringify({ token: session.token }),
      });
    } catch (_) {}
  }
  writeSession(null);
}

export function isAllowedRole(roleOrUser, allowedRoles = []) {
  if (!allowedRoles.length) return true;
  const role = toRole(roleOrUser);
  return allowedRoles.includes(role);
}

function currentPageName() {
  const p = location.pathname.split("/").filter(Boolean).pop() || "";
  return p === "" || p === "index.html" ? "index.html" : p;
}

function redirectToLogin() {
  const next = currentPageName();
  const q = next !== "index.html" ? `?next=${encodeURIComponent(next)}` : "";
  const loginPath = "/login.html" + q;
  location.replace(location.origin + loginPath);
}

export function getDefaultHomeForRole(roleOrUser) {
  const role = toRole(roleOrUser);
  if (role === "technician") return "activities.html";
  return "index.html";
}

function loginLocal(username, password) {
  const u = DEFAULT_USERS.find(
    (e) => e.username === String(username ?? "").toLowerCase() && e.password === String(password ?? ""),
  );
  if (!u) return null;
  const session = sanitizeSession(u, false);
  writeSession(session);
  return session;
}

export function requireAuthenticatedUser({ allowedRoles = [] } = {}) {
  let user = getCurrentUser();
  if (!user) {
    redirectToLogin();
    return null;
  }
  if (!isAllowedRole(user, allowedRoles)) {
    location.href = getDefaultHomeForRole(user);
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
