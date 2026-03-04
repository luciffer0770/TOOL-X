const registry = [];

function normalizedCombo(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  const key = String(event.key || "").toUpperCase();
  if (!key) return "";
  parts.push(key);
  return parts.join("+");
}

/**
 * Register a keyboard shortcut.
 * Example:
 *   registerShortcut({
 *     combo: "Ctrl+K",
 *     scope: "activities",
 *     handler: (event) => { ... },
 *   });
 */
export function registerShortcut({ combo, scope = "global", handler }) {
  if (!combo || typeof handler !== "function") return;
  registry.push({
    combo: combo.toUpperCase(),
    scope,
    handler,
  });
}

/**
 * Internal: dispatch a keydown event to matching shortcuts.
 * Called from shell.js once per page.
 */
export function handleShortcutEvent(event, activeScope) {
  const combo = normalizedCombo(event);
  if (!combo) return;
  const scope = activeScope || "global";
  registry.forEach((entry) => {
    if (entry.combo !== combo) return;
    if (entry.scope !== "global" && entry.scope !== scope) return;
    try {
      const result = entry.handler(event);
      if (result === false) {
        event.preventDefault();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[shortcuts] handler error", err);
    }
  });
}

