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
  { id: "welcome", target: ".title-block", title: "Welcome to ATLAS Planning", body: "This quick tour will show you the main features. You can skip anytime.", position: "bottom" },
  { id: "nav", target: ".nav", title: "Navigation", body: "Use these links to switch between Dashboard, Activity Master, Gantt, Materials, and Intelligence.", position: "bottom" },
  { id: "project", target: ".project-toolbar", title: "Projects", body: "Create, switch, duplicate, or rename projects. Each project has its own activities.", position: "bottom" },
  { id: "kpi", target: "#kpi-grid", title: "KPIs", body: "Key metrics update in real time. Click cards to drill down.", position: "top" },
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
      <button type="button" class="onboarding-skip ghost">Skip tour</button>
      <span class="onboarding-progress">${index + 1} / ${total}</span>
      <button type="button" class="onboarding-next">${index < total - 1 ? "Next" : "Finish"}</button>
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

  function showStep() {
    const step = STEPS[index];
    const targetEl = document.querySelector(step.target);
    if (!targetEl) {
      index++;
      if (index < STEPS.length) showStep();
      else finish();
      return;
    }

    overlay.innerHTML = "";
    const spotlight = createSpotlight(step.target);
    if (spotlight) overlay.appendChild(spotlight);

    const tooltip = createTooltip(step, index, STEPS.length, () => {
      index++;
      if (index < STEPS.length) showStep();
      else finish();
    }, finish);
    overlay.appendChild(tooltip);

    const rect = targetEl.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + 12}px`;
    tooltip.style.left = `${rect.left}px`;
  }

  function finish() {
    setOnboardingComplete();
    overlay.remove();
  }

  showStep();
}
