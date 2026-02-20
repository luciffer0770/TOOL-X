import { getDefaultHomeForRole, getCurrentUser, listDemoUsers, login } from "./auth.js";
import { notify } from "./common.js";

const form = document.querySelector("#login-form");
const usernameInput = document.querySelector("#username-input");
const passwordInput = document.querySelector("#password-input");
const demoUserList = document.querySelector("#demo-user-list");
const loginHint = document.querySelector("#login-hint");
const forgotPasswordButton = document.querySelector(".login-link-btn");

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
    .map(
      (user) => `
      <li class="demo-user-item role-${escapeHtml(user.role)}" data-username="${escapeHtml(user.username)}" data-password="${escapeHtml(user.username)}123">
        <span class="demo-user-icon" aria-hidden="true">${roleBadgeText(user.role)}</span>
        <span class="demo-user-main">
          <strong>${escapeHtml(user.displayName)}</strong>
          <span>username: ${escapeHtml(user.username)} | password: ${escapeHtml(user.username)}123</span>
        </span>
      </li>
    `,
    )
    .join("");
  demoUserList.innerHTML = items;
}

function wireDemoUserQuickFill() {
  demoUserList.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
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

function initialize() {
  handleExistingSession();
  renderDemoUsers();
  wireDemoUserQuickFill();
  loginHint.textContent = "Use the demo credentials below or enter custom credentials.";
  usernameInput.focus();

  if (forgotPasswordButton) {
    forgotPasswordButton.addEventListener("click", () => {
      notify("Password reset is disabled in this frontend-only demo.", "warning");
    });
  }

  const quickDemoBtn = document.querySelector("#quick-demo-btn");
  if (quickDemoBtn) {
    quickDemoBtn.addEventListener("click", () => {
      const user = login("planner", "planner123");
      if (user) {
        const nextPage = parseNextPage() || getDefaultHomeForRole(user);
        location.href = nextPage;
      }
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const user = login(usernameInput.value, passwordInput.value);
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
