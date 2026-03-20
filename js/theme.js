/** Theme toggle (light/dark mode) */
const STORAGE_KEY = "industrial_planning_theme";

export function getSystemPreference() {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "auto") return getSystemPreference();
    return stored || "light";
  } catch {
    return "light";
  }
}

export function setTheme(theme) {
  const stored = theme === "dark" ? "dark" : theme === "auto" ? "auto" : "light";
  try {
    localStorage.setItem(STORAGE_KEY, stored);
  } catch (_) {}
  const applied = stored === "auto" ? getSystemPreference() : stored;
  document.documentElement.setAttribute("data-theme", applied === "dark" ? "dark" : "");
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function initThemeToggle() {
  const current = getTheme();
  setTheme(current);
  const btn = document.querySelector("#theme-toggle-btn");
  if (btn) {
    const aria = current === "dark" ? "Switch to light" : "Switch to dark";
    btn.setAttribute("aria-label", aria);
    btn.title = aria;
    const labEl = btn.querySelector(".theme-toggle-label");
    if (labEl) labEl.textContent = current === "dark" ? "Light mode" : "Dark mode";
    else btn.textContent = current === "dark" ? "Light" : "Dark";
    btn.addEventListener("click", () => {
      const next = toggleTheme();
      const lab = btn.querySelector(".theme-toggle-label");
      if (lab) lab.textContent = next === "dark" ? "Light mode" : "Dark mode";
      else btn.textContent = next === "dark" ? "Light" : "Dark";
      btn.setAttribute("aria-label", next === "dark" ? "Switch to light" : "Switch to dark");
      btn.title = next === "dark" ? "Switch to light" : "Switch to dark";
    });
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (localStorage.getItem(STORAGE_KEY) === "auto") setTheme(getSystemPreference());
    });
  }
}
