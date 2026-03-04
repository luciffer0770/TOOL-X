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
  } = options || {};

  if (typeof onReady !== "function") {
    throw new Error("initPage(options): onReady callback is required");
  }

  await stateReady();

  // Shell (shortcuts, global search, audit, notifications, SW)
  initShell();

  // Access + role wiring (unless explicitly disabled)
  let currentUser = null;
  if (requireAuth) {
    currentUser = initializeAccessShell({ allowedRoles });
    if (!currentUser) {
      // initializeAccessShell already handled redirect when unauthenticated
      return { user: null, unsubscribe: () => {} };
    }
  }

  // Project toolbar + initial render hook
  const toolbarOptions = {};
  if (typeof onProjectChange === "function") {
    toolbarOptions.onProjectChange = onProjectChange;
  }
  if (Object.keys(toolbarOptions).length) {
    initializeProjectToolbar(toolbarOptions);
  } else {
    initializeProjectToolbar();
  }

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

