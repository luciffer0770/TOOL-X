/**
 * Shared shell behavior: keyboard shortcuts, nav toggle, help button, global search.
 * Load this on all app pages (not login).
 */
import { notify, showKeyboardShortcuts, showNotificationHistory } from "./common.js";
import { canUndo, undo } from "./undo.js";
import { initGlobalSearch } from "./global-search.js";
import { showAuditTrail } from "./audit.js";

export function initShell() {
  initGlobalSearch();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js?v=5").catch(() => {});
  }
  const nav = document.querySelector(".nav");
  const helpBtn = document.createElement("button");
  helpBtn.className = "ghost nav-help-btn";
  helpBtn.type = "button";
  helpBtn.textContent = "?";
  helpBtn.title = "Keyboard shortcuts (Ctrl+/)";
  helpBtn.setAttribute("aria-label", "Show keyboard shortcuts");
  nav?.appendChild(helpBtn);

  const notifBtn = document.createElement("button");
  notifBtn.className = "ghost";
  notifBtn.type = "button";
  notifBtn.textContent = "🔔";
  notifBtn.title = "Notification history";
  notifBtn.setAttribute("aria-label", "Notification history");
  nav?.appendChild(notifBtn);
  notifBtn?.addEventListener("click", showNotificationHistory);

  const auditBtn = document.createElement("button");
  auditBtn.className = "ghost";
  auditBtn.type = "button";
  auditBtn.textContent = "📋";
  auditBtn.title = "Change history";
  auditBtn.setAttribute("aria-label", "Change history");
  nav?.appendChild(auditBtn);
  auditBtn?.addEventListener("click", showAuditTrail);

  const navToggle = document.createElement("button");
  navToggle.className = "ghost nav-toggle";
  navToggle.type = "button";
  navToggle.setAttribute("aria-label", "Toggle navigation");
  navToggle.innerHTML = "☰";
  nav?.parentElement?.insertBefore(navToggle, nav);

  navToggle?.addEventListener("click", () => {
    nav?.classList.toggle("is-open");
  });

  helpBtn?.addEventListener("click", showKeyboardShortcuts);

  const themeToggle = document.createElement("button");
  themeToggle.className = "ghost theme-toggle";
  themeToggle.type = "button";
  themeToggle.title = "Toggle dark/light mode";
  themeToggle.textContent = "☀";
  themeToggle.setAttribute("aria-label", "Toggle theme");
  const sessionChip = document.querySelector(".session-chip");
  sessionChip?.parentElement?.insertBefore(themeToggle, sessionChip);
  const savedTheme = localStorage.getItem("industrial_planning_theme") || "light";
  if (savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggle.textContent = "🌙";
  } else {
    themeToggle.textContent = "☀";
  }
  themeToggle.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    document.documentElement.setAttribute("data-theme", isDark ? "" : "dark");
    themeToggle.textContent = isDark ? "☀" : "🌙";
    localStorage.setItem("industrial_planning_theme", isDark ? "light" : "dark");
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      showKeyboardShortcuts();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      if (e.shiftKey) return;
      e.preventDefault();
      if (canUndo()) {
        const result = undo();
        if (result.ok) {
          window.dispatchEvent(new CustomEvent("industrial_planning_state_changed"));
          notify(`Undone: ${result.description}`, "success");
        }
      }
    }
  });
}
