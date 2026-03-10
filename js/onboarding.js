/**
 * Onboarding tour – first-time walkthrough.
 */
const ONBOARDING_KEY = "atlas_planning_onboarding_done";

export function hasCompletedOnboarding() {
  return localStorage.getItem(ONBOARDING_KEY) === "1";
}

export function setOnboardingComplete() {
  localStorage.setItem(ONBOARDING_KEY, "1");
}

export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY);
}

const STEPS = [
  { id: "welcome", target: ".title-block", title: "Welcome to ATLAS", body: "This quick tour walks through the main areas: navigation, projects, KPIs, activity management, imports/exports, Gantt, and more. Click Next to continue or Skip to exit anytime.", position: "bottom" },
  { id: "nav", target: ".nav", title: "Top Navigation", body: "Primary navigation: switch between the Executive Dashboard, Activity Master, Gantt, Material Intelligence, Delay & Risk, and Anomaly Center. Use these to move between high-level views.", position: "bottom" },
  { id: "project", target: ".project-toolbar", title: "Project Controls", body: "Active Project controls let you create new projects, duplicate templates, rename, delete, export or import an entire project. The Active Project drives the datasets shown across pages.", position: "bottom" },
  { id: "kpi", target: "#kpi-grid", title: "KPIs Overview", body: "KPI cards show live portfolio metrics. Click a KPI card to jump into the Activity Master filtered to the relevant set (e.g. Delayed activities). Use these for quick situational awareness.", position: "top" },
  { id: "activityGrid", target: "#activities-table-wrap", title: "Activity Data Grid", body: "This is the master activity table. Add rows, edit fields inline, insert above/below, and use bulk actions. Use Add Empty Row to quickly create a draft activity.", position: "right" },
  { id: "columnControls", target: "#column-dropdown-toggle", title: "Column Visibility", body: "Show or hide columns using the Select Visible Columns panel. Presets (All/Core/Compact) speed layout changes for reporting or compact views.", position: "bottom" },
  { id: "importZone", target: "#import-drop-zone", title: "Import & Drag-Drop", body: "Import Excel or CSV files. The importer validates required columns and shows a preview + validation report before merging or replacing data.", position: "top" },
  { id: "undoRedo", target: "#undo-btn", title: "Undo / Redo", body: "Use Ctrl+Z to undo recent destructive operations (delete, clear, import). Redo is available with Ctrl+Y. Use the Undo button when visible to revert changes quickly.", position: "left" },
  { id: "shortcuts", target: ".nav-help-btn", title: "Keyboard Shortcuts", body: "Common shortcuts: Ctrl+K (focus activity search), Ctrl+N (add activity), Ctrl+E (export CSV). Ctrl+/ opens this shortcuts modal.", position: "left" },
  { id: "ganttLink", target: "a[data-nav][href='gantt.html']", title: "Gantt & Dependencies", body: "Gantt provides timeline bars and dependency lines. Drag bars to reschedule or resize to change planned dates (where enabled).", position: "bottom" },
  { id: "materialsLink", target: "a[data-nav][href='materials.html']", title: "Material Intelligence", body: "Material Intelligence helps track ownership, lead times and supply signals impacting activities. Use this to identify material risks.", position: "bottom" },
  { id: "intelligenceLink", target: "a[data-nav][href='intelligence.html']", title: "Delay, Risk & Optimization", body: "Run delay detection, risk scoring and what-if scenario simulations (manpower/lead-time/overtime) to see portfolio impacts and mitigation options.", position: "bottom" },
  { id: "anomalyLink", target: "a[data-nav][href='anomaly-center.html']", title: "Anomaly & Baselines", body: "The Anomaly Center shows data-quality issues, baselines and recommended actions. Use this for operational alerts and remediation workflows.", position: "bottom" },
  { id: "help", target: ".nav-help-btn", title: "Final Tips & Help", body: "That's the tour. For quick help press Ctrl+/. For exporting, use the Export buttons (CSV/Excel/PDF). Use the Search (Ctrl+K) to find activities instantly.", position: "left" },
];

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "onboarding-overlay";
  overlay.setAttribute("aria-hidden", "true");
  return overlay;
}

function createSpotlight(target) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const spotlight = document.createElement("div");
  spotlight.className = "onboarding-spotlight";
  spotlight.style.cssText = `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px`;
  return spotlight;
}

function createTooltip(step, index, total, onNext, onSkip) {
  const div = document.createElement("div");
  div.className = "onboarding-tooltip";
  div.innerHTML = `
    <h3 class="onboarding-tooltip-title">${step.title}</h3>
    <p class="onboarding-tooltip-body">${step.body}</p>
    <div class="onboarding-tooltip-actions">
      <button type="button" class="onboarding-skip ghost" aria-label="Skip tour">Skip</button>
      <span class="onboarding-progress" aria-live="polite">${index + 1} / ${total}</span>
      <button type="button" class="onboarding-next" aria-label="${index < total - 1 ? "Next step" : "Finish tour"}">${index < total - 1 ? "Next" : "Finish"}</button>
    </div>
  `;
  div.querySelector(".onboarding-next").addEventListener("click", onNext);
  div.querySelector(".onboarding-skip").addEventListener("click", onSkip);
  return div;
}

export function startOnboarding() {
  if (hasCompletedOnboarding()) return;

  const overlay = createOverlay();
  document.body.appendChild(overlay);

  let index = 0;
  // prevent background scroll while onboarding is active
  const previousOverflow = document.documentElement.style.overflow || document.body.style.overflow || "";
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  let currentSpotlight = null;
  let currentTooltip = null;
  let targetElCurrent = null;
  let scrollHandler = null;
  let resizeHandler = null;

  function showStep() {
    const step = STEPS[index];
    const targetEl = document.querySelector(step.target);
    if (!targetEl) {
      index++;
      if (index < STEPS.length) showStep();
      else finish();
      return;
    }
    // remove previous listeners before replacing overlay contents
    if (scrollHandler) {
      window.removeEventListener("scroll", scrollHandler, { passive: true });
      scrollHandler = null;
    }
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
    // defensive: remove any stray tooltip/spotlight nodes from previous runs
    try {
      document.querySelectorAll(".onboarding-tooltip").forEach((n) => n.remove());
      document.querySelectorAll(".onboarding-spotlight").forEach((n) => n.remove());
      // also remove any other onboarding-overlay elements
      document.querySelectorAll(".onboarding-overlay").forEach((n, i) => { if (n !== overlay) n.remove(); });
    } catch (_) {}
    // remove any previously created spotlight/tooltip nodes explicitly
    try {
      if (currentSpotlight && currentSpotlight.parentNode) currentSpotlight.parentNode.removeChild(currentSpotlight);
    } catch (_) {}
    try {
      if (currentTooltip && currentTooltip.parentNode) currentTooltip.parentNode.removeChild(currentTooltip);
    } catch (_) {}
    // clear overlay contents
    overlay.innerHTML = "";
    const spotlight = createSpotlight(step.target);
    if (spotlight) {
      overlay.appendChild(spotlight);
      currentSpotlight = spotlight;
    } else {
      currentSpotlight = null;
    }

    const tooltip = createTooltip(step, index, STEPS.length, () => {
      index++;
      if (index < STEPS.length) showStep();
      else finish();
    }, finish);
    overlay.appendChild(tooltip);
    currentTooltip = tooltip;
    targetElCurrent = targetEl;

    // Ensure element is in view (center) before positioning
    try {
      if (targetEl && typeof targetEl.scrollIntoView === "function") {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    } catch (_) {}

    // position tooltip and spotlight (with clamping)
    function positionElements() {
      if (!targetElCurrent) return;
      const rect = targetElCurrent.getBoundingClientRect();
      if (currentSpotlight) {
        currentSpotlight.style.top = `${rect.top}px`;
        currentSpotlight.style.left = `${rect.left}px`;
        currentSpotlight.style.width = `${rect.width}px`;
        currentSpotlight.style.height = `${rect.height}px`;
      }
      const tooltipMargin = 12;
      const docW = document.documentElement.clientWidth;
      const docH = document.documentElement.clientHeight;
      let top = rect.bottom + tooltipMargin;
      let left = rect.left;
      const ttWidth = Math.min(520, Math.max(260, rect.width));
      const ttHeight = 140;
      if (top + ttHeight > docH) {
        top = rect.top - ttHeight - tooltipMargin;
      }
      if (left + ttWidth > docW - 12) left = docW - ttWidth - 12;
      if (left < 12) left = 12;
      if (currentTooltip) {
        currentTooltip.style.top = `${Math.max(8, top)}px`;
        currentTooltip.style.left = `${Math.max(8, left)}px`;
        currentTooltip.style.width = `${ttWidth}px`;
      }
    }

    // initial position after scroll completes
    setTimeout(positionElements, 350);
    // attach listeners to keep in place on scroll/resize
    scrollHandler = positionElements;
    resizeHandler = positionElements;
    window.addEventListener("scroll", scrollHandler, { passive: true });
    window.addEventListener("resize", resizeHandler);
  }

  function finish() {
    setOnboardingComplete();
    overlay.remove();
    // restore scroll
    document.documentElement.style.overflow = previousOverflow;
    document.body.style.overflow = previousOverflow;
    // remove listeners if left
    try {
      if (scrollHandler) {
        window.removeEventListener("scroll", scrollHandler, { passive: true });
        scrollHandler = null;
      }
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
      }
    } catch (_) {}
    currentSpotlight = null;
    currentTooltip = null;
    targetElCurrent = null;
  }

  showStep();
}
