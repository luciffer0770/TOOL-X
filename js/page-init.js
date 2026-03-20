import { initShell } from "./shell.js";
import { initializeAccessShell } from "./access-shell.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { subscribeToStateChanges, stateReady } from "./storage.js";

/**
 * Shared page initialization helper.
 *
 * Usage:
 *   initPage({
 *     requireAuth: true,
 *     allowedRoles: [], // optional
 *     onReady(user) { ... },          // required
 *     onProjectChange() { ... },      // optional
 *     onStateChange() { ... },        // optional
 *     projectToolbarMode: "switcher", // "full" only on Project Setup hub
 *   });
 *
 * - Waits for state (backend API or localStorage) before proceeding
 * - Ensures shell + access shell are initialized exactly once per page
 * - Wires project toolbar with an optional project-change callback
 * - Subscribes to state changes and returns an unsubscribe cleanup
 */
export async function initPage(options) {
  const {
    requireAuth = true,
    allowedRoles = [],
    onReady,
    onProjectChange,
    onStateChange,
    projectToolbarMode = "switcher",
  } = options || {};

  if (typeof onReady !== "function") {
    throw new Error("initPage(options): onReady callback is required");
  }

  await stateReady();

  let currentUser = null;
  if (requireAuth) {
    currentUser = initializeAccessShell({ allowedRoles });
    if (!currentUser) return { user: null, unsubscribe: () => {} };
  }

  try { initShell(); } catch (e) { console.error("[initPage] shell:", e); }

  const toolbarOptions = { mode: projectToolbarMode };
  if (typeof onProjectChange === "function") toolbarOptions.onProjectChange = onProjectChange;
  try {
    initializeProjectToolbar(toolbarOptions);
  } catch (e) { console.error("[initPage] toolbar:", e); }

  // State change subscription (optional)
  let unsubscribe = () => {};
  if (typeof onStateChange === "function") {
    unsubscribe = subscribeToStateChanges(onStateChange);
    window.addEventListener(
      "pagehide",
      () => {
        try {
          unsubscribe();
        } catch (_) {}
      },
      { once: true },
    );
  }

  // Hand control to page-specific code
  onReady(currentUser);

  return { user: currentUser, unsubscribe };
}

