import { getDefaultHomeForRole, getCurrentUser, listDemoUsers, login } from "./auth.js";
import { notify } from "./common.js";

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

function renderDemoUsers() {
  const items = listDemoUsers()
    .map(
      (user) => `
      <li>
        <strong>${user.displayName}</strong><br />
        <span class="small">username: ${user.username} | password: ${user.username}123</span>
      </li>
    `,
    )
    .join("");
  demoUserList.innerHTML = items;
}

function handleExistingSession() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  location.href = parseNextPage() || getDefaultHomeForRole(currentUser);
}

function initialize() {
  handleExistingSession();
  renderDemoUsers();
  loginHint.textContent = "Use role credentials to open tailored dashboard access.";
  usernameInput.focus();

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
