import { getDefaultHomeForRole, getCurrentUser, getDemoPassword, listDemoUsers, login } from "./auth.js";
import { escapeHtml, notify, showModal } from "./common.js";
import { resetApplicationData } from "./storage.js";

function qs(sel) {
  return document.querySelector(sel);
}

function parseNextPage() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  if (!next) return "";
  if (!/^[a-z0-9._-]+\.html$/i.test(next)) return "";
  return next;
}

function toAppUrl(page) {
  const path = location.pathname;
  const dir = path.replace(/\/[^/]*$/, "/");
  return location.origin + dir + page;
}

function roleBadgeText(role) {
  if (role === "planner") return "PL";
  if (role === "management") return "MG";
  return "TC";
}

function renderDemoUsers() {
  const demoUserList = qs("#demo-user-list");
  if (!demoUserList) return;
  const items = listDemoUsers()
    .map((user) => {
      const password = getDemoPassword(user.username);
      return `
      <li class="demo-user-item role-${escapeHtml(user.role)}" data-username="${escapeHtml(user.username)}" data-password="${escapeHtml(password)}">
        <span class="demo-user-icon" aria-hidden="true">${roleBadgeText(user.role)}</span>
        <span class="demo-user-main">
          <strong>${escapeHtml(user.displayName)}</strong>
          <span>username: ${escapeHtml(user.username)} | password: ${escapeHtml(password)}</span>
        </span>
        <button type="button" class="demo-user-copy ghost" data-username="${escapeHtml(user.username)}" data-password="${escapeHtml(password)}" title="Copy credentials">Copy</button>
      </li>
    `;
    })
    .join("");
  demoUserList.innerHTML = items;
}

function wireDemoUserQuickFill() {
  const demoUserList = qs("#demo-user-list");
  if (!demoUserList) return;
  demoUserList.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.classList.contains("demo-user-copy")) {
      const username = target.dataset.username || "";
      const password = target.dataset.password || "";
      const text = `username: ${username}\npassword: ${password}`;
      navigator.clipboard.writeText(text).then(
        () => notify("Credentials copied to clipboard.", "success"),
        () => notify("Copy failed. Use username: " + username + " password: " + password, "info"),
      );
      return;
    }
    const item = target.closest(".demo-user-item");
    if (!item) return;
    const usernameInput = qs("#username-input");
    const passwordInput = qs("#password-input");
    if (usernameInput) usernameInput.value = item.dataset.username || "";
    if (passwordInput) passwordInput.value = item.dataset.password || "";
    (passwordInput || usernameInput)?.focus();
  });
}

function handleExistingSession() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  const page = parseNextPage() || getDefaultHomeForRole(currentUser);
  location.replace(toAppUrl(page));
}

function wirePasswordToggle() {
  const toggle = qs("#password-toggle");
  const passwordInput = qs("#password-input");
  if (!toggle || !passwordInput) return;
  toggle.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggle.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
    toggle.querySelector(".password-toggle-icon").textContent = isPassword ? "🙈" : "👁";
  });
}

function initialize() {
  handleExistingSession();
  renderDemoUsers();
  wireDemoUserQuickFill();
  wirePasswordToggle();

  const loginHint = qs("#login-hint");
  const usernameInput = qs("#username-input");
  if (loginHint) loginHint.textContent = "Use the demo credentials below or enter custom credentials.";
  usernameInput?.focus();

  const quickDemoBtn = qs("#quick-demo-btn");
  if (quickDemoBtn) {
    quickDemoBtn.addEventListener("click", () => {
      const user = login("planner", "planner123", false);
      if (user) {
        const page = parseNextPage() || getDefaultHomeForRole(user);
        location.replace(toAppUrl(page));
      }
    });
  }

  const form = qs("#login-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const uInput = qs("#username-input");
      const pInput = qs("#password-input");
      const rememberMe = qs("#remember-me")?.checked ?? false;
      const user = login(uInput?.value ?? "", pInput?.value ?? "", rememberMe);
      if (!user) {
        notify("Invalid credentials. Try one of the demo users.", "error");
        if (pInput) pInput.value = "";
        (uInput || pInput)?.focus();
        return;
      }
      notify(`Welcome ${user.displayName}.`, "success");
      const page = parseNextPage() || getDefaultHomeForRole(user);
      location.replace(toAppUrl(page));
    });
  }

  const resetBtn = qs("#reset-data-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const confirmed = await showModal({
        title: "Reset Application Data",
        body: "This will clear all projects, activities, login session, and undo history. You will start with a fresh empty project. This cannot be undone.",
        primaryLabel: "Reset & Reload",
        secondaryLabel: "Cancel",
        danger: true,
      });
      if (confirmed) {
        resetApplicationData();
        notify("Data cleared. Reloading…", "info");
        location.reload();
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    try {
      initialize();
    } catch (err) {
      console.error("Login init error:", err);
      const hint = qs("#login-hint");
      if (hint) hint.textContent = "Load error. Ensure you're using a web server (e.g. python -m http.server 8080) and refresh.";
    }
  });
} else {
  try {
    initialize();
  } catch (err) {
    console.error("Login init error:", err);
    const hint = qs("#login-hint");
    if (hint) hint.textContent = "Load error. Ensure you're using a web server and refresh.";
  }
}
