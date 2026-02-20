import { getDefaultHomeForRole, getCurrentUser, getDemoPassword, listDemoUsers, login } from "./auth.js";
import { escapeHtml, notify } from "./common.js";

const form = document.querySelector("#login-form");
const usernameInput = document.querySelector("#username-input");
const passwordInput = document.querySelector("#password-input");
const demoUserList = document.querySelector("#demo-user-list");
const loginHint = document.querySelector("#login-hint");

function parseNextPage() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  if (!next) return "";
  if (!/^[a-z0-9._-]+\.html$/i.test(next)) return "";
  return next;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function roleBadgeText(role) {
  if (role === "planner") return "PL";
  if (role === "management") return "MG";
  return "TC";
}

function renderDemoUsers() {
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
    usernameInput.value = item.dataset.username || "";
    passwordInput.value = item.dataset.password || "";
    passwordInput.focus();
  });
}

function handleExistingSession() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  location.href = parseNextPage() || getDefaultHomeForRole(currentUser);
}

function wirePasswordToggle() {
  const toggle = document.querySelector("#password-toggle");
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
  if (loginHint) loginHint.textContent = "Use the demo credentials below or enter custom credentials.";
  usernameInput?.focus();

  const quickDemoBtn = document.querySelector("#quick-demo-btn");
  if (quickDemoBtn) {
    quickDemoBtn.addEventListener("click", () => {
      const user = login("planner", "planner123", false);
      if (user) {
        const nextPage = parseNextPage() || getDefaultHomeForRole(user);
        location.href = nextPage;
      }
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const rememberMe = document.querySelector("#remember-me")?.checked ?? false;
    const user = login(usernameInput.value, passwordInput.value, rememberMe);
    if (!user) {
      notify("Invalid credentials. Try one of the demo users.", "error");
      passwordInput.value = "";
      passwordInput.focus();
      return;
    }
    notify(`Welcome ${user.displayName}.`, "success");
    const nextPage = parseNextPage() || getDefaultHomeForRole(user);
    location.href = nextPage;
  });
}

initialize();
