/**
 * Shared shell behavior: keyboard shortcuts, nav toggle, help button, global search.
 * Load this on all app pages (not login).
 */
import { notify, showKeyboardShortcuts, showNotificationHistory } from "./common.js";
import { startOnboarding, resetOnboarding } from "./onboarding.js";
import { canUndo, undo, canRedo, redo, getRedoDescription } from "./undo.js";
import { initGlobalSearch } from "./global-search.js";
import { showAuditTrail } from "./audit.js";
import { handleShortcutEvent } from "./shortcuts.js";
import { initThemeToggle } from "./theme.js";
import { initAlertsBell } from "./alerts.js";

export function initShell() {
  initGlobalSearch();
  if ("serviceWorker" in navigator) {
    // register at root scope to avoid scope issues
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  // Dashboard quick controls (if present)
  const refreshBtn = document.querySelector("#dashboard-refresh-btn");
  const tourBtn = document.querySelector("#dashboard-tour-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      // Simple refresh behavior: reload the page so all pages pick up new data
      try {
        location.reload();
      } catch (_) {
        // fallback
        location.href = location.href;
      }
    });
  }
  if (tourBtn) {
    tourBtn.addEventListener("click", () => {
      try {
        resetOnboarding();
      } catch (_) {}
      try {
        startOnboarding();
      } catch (err) {
        console.error("Failed to start onboarding:", err);
        notify("Unable to start tour. See console for details.", "error");
      }
    });
  }
  // Expose helpers on window so users can trigger tour/refresh from Console if needed
  try {
    window.startAtlasTour = () => {
      try { resetOnboarding(); } catch (_) {}
      try { startOnboarding(); } catch (e) { console.error(e); notify("Unable to start tour", "error"); }
    };
    window.refreshAtlasPage = () => { try { location.reload(); } catch (_) { location.href = location.href; } };
  } catch (_) {}
  const nav = document.querySelector(".nav");
  const helpBtn = document.createElement("button");
  helpBtn.className = "ghost sidebar-tool-btn nav-help-btn";
  helpBtn.type = "button";
  helpBtn.innerHTML = "<span class=\"sidebar-tool-label\">Shortcuts</span><span class=\"sidebar-tool-hint\">Ctrl+/</span>";
  helpBtn.title = "Keyboard shortcuts (Ctrl+/)";
  helpBtn.setAttribute("aria-label", "Show keyboard shortcuts");
  nav?.appendChild(helpBtn);

  const notifBtn = document.createElement("button");
  notifBtn.className = "ghost sidebar-tool-btn";
  notifBtn.type = "button";
  notifBtn.innerHTML = "<span class=\"sidebar-tool-label\">Alerts</span><span class=\"sidebar-tool-hint\">History</span>";
  notifBtn.title = "Notification history";
  notifBtn.setAttribute("aria-label", "Notification history");
  nav?.appendChild(notifBtn);
  notifBtn?.addEventListener("click", showNotificationHistory);

  const themeBtn = document.createElement("button");
  themeBtn.id = "theme-toggle-btn";
  themeBtn.className = "ghost sidebar-tool-btn";
  themeBtn.type = "button";
  themeBtn.innerHTML = "<span class=\"sidebar-tool-label theme-toggle-label\">Theme</span>";
  themeBtn.title = "Toggle light / dark theme";
  nav?.appendChild(themeBtn);
  try { initThemeToggle(); } catch (e) { console.warn("[shell] theme init:", e); }
  try { initAlertsBell(); } catch (e) { console.warn("[shell] alerts init:", e); }

  const auditBtn = document.createElement("button");
  auditBtn.className = "ghost sidebar-tool-btn";
  auditBtn.type = "button";
  auditBtn.innerHTML = "<span class=\"sidebar-tool-label\">Audit</span><span class=\"sidebar-tool-hint\">Changes</span>";
  auditBtn.title = "Change history";
  auditBtn.setAttribute("aria-label", "Change history");
  nav?.appendChild(auditBtn);
  auditBtn?.addEventListener("click", showAuditTrail);

  const navToggle = document.createElement("button");
  navToggle.className = "ghost nav-toggle";
  navToggle.type = "button";
  navToggle.setAttribute("aria-label", "Toggle navigation");
  navToggle.innerHTML = "<span class=\"nav-toggle-label\">Menu</span>";
  nav?.parentElement?.insertBefore(navToggle, nav);

  navToggle?.addEventListener("click", () => {
    nav?.classList.toggle("is-open");
    document.querySelector(".app-sidebar")?.classList.toggle("is-open");
  });

  helpBtn?.addEventListener("click", showKeyboardShortcuts);

  document.addEventListener("keydown", (e) => {
    // Built-in shortcuts (always available)
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      showKeyboardShortcuts();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      if (canUndo()) {
        const result = undo();
        if (result.ok) {
          window.dispatchEvent(new CustomEvent("industrial_planning_state_changed"));
          notify(`Undone: ${result.description}`, "success");
        }
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      // Ctrl+Y or Ctrl+Shift+Z for Redo
      e.preventDefault();
      if (canRedo()) {
        const result = redo();
        if (result.ok) {
          window.dispatchEvent(new CustomEvent("industrial_planning_state_changed"));
          notify(`Redone: ${result.description || getRedoDescription()}`, "success");
        }
      }
      return;
    }

    // Page-level shortcuts (registered via shortcuts.js)
    try {
      const page = location.pathname.split("/").pop() || "index.html";
      const scope = page.replace(".html", "");
      handleShortcutEvent(e, scope);
    } catch (_) {
      handleShortcutEvent(e, "global");
    }
  });
}
