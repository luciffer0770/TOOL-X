/** Network diagram - activity dependencies with custom layout, zoom, pan, drag, critical path, export */
import { escapeHtml, notify, setActiveNavigation } from "./common.js";
import { parseDependencies } from "./schema.js";
import { getActivities } from "./storage.js";
import {
  buildDependencyGraph,
  getBlockedActivities,
  getCriticalPath,
  getPlannedDurationHours,
  topologicalSort,
} from "./analytics.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";

const NODE_WIDTH = 120;
const NODE_HEIGHT = 40;
const LAYER_GAP = 60;
const ROW_GAP = 36;
const MAX_NODES_PER_ROW = 8;
const MAX_CANVAS_WIDTH = 1800;
const MAX_CANVAS_HEIGHT = 900;

let criticalPathToggle = true;
let zoom = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let draggedNodeId = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let didDrag = false;
let nodePositions = {};

/** Custom hierarchical layout - no external deps, predictable coordinates */
function computeLayout(activities, criticalPathSet) {
  const byId = new Map(activities.map((a) => [a.activityId, a]));
  const graph = buildDependencyGraph(activities);
  const order = topologicalSort(activities);
  const blocked = new Set(getBlockedActivities(activities).map((a) => a.activityId));

  const layers = [];
  const idToLayer = new Map();
  const layerRows = new Map();

  for (const id of order) {
    const deps = graph.get(id) ?? [];
    let layer = 0;
    for (const depId of deps) {
      layer = Math.max(layer, (idToLayer.get(depId) ?? -1) + 1);
    }
    idToLayer.set(id, layer);
    if (!layerRows.has(layer)) layerRows.set(layer, []);
    layerRows.get(layer).push(id);
  }

  const positions = {};
  const paddingX = 40;
  const paddingY = 40;
  let maxX = 0;
  let maxY = 0;

  layerRows.forEach((ids, layer) => {
    const baseX = paddingX + layer * (NODE_WIDTH + LAYER_GAP);
    const perRow = Math.min(ids.length, MAX_NODES_PER_ROW);
    const numRows = Math.ceil(ids.length / perRow);
    ids.forEach((id, idx) => {
      const row = Math.floor(idx / perRow);
      const col = idx % perRow;
      const x = baseX + col * (NODE_WIDTH + LAYER_GAP * 0.5);
      const y = paddingY + row * (NODE_HEIGHT + ROW_GAP);
      positions[id] = { x: x + NODE_WIDTH / 2, y: y + NODE_HEIGHT / 2 };
      maxX = Math.max(maxX, x + NODE_WIDTH);
      maxY = Math.max(maxY, y + NODE_HEIGHT);
    });
  });

  const canvasWidth = Math.min(MAX_CANVAS_WIDTH, Math.max(800, maxX + paddingX));
  const canvasHeight = Math.min(MAX_CANVAS_HEIGHT, Math.max(450, maxY + paddingY));

  const nodes = order.map((id) => ({
    id,
    ...byId.get(id),
    isBlocked: blocked.has(id),
    isCritical: criticalPathSet.has(id),
    label: `${id}\n${((byId.get(id)?.activityName || "").slice(0, 20) || "")}${(byId.get(id)?.activityName || "").length > 20 ? "…" : ""}`,
  }));

  const edges = [];
  activities.forEach((a) => {
    const deps = parseDependencies(a.dependencies);
    deps.forEach((depId) => {
      if (byId.has(depId) && positions[depId] && positions[a.activityId]) {
        edges.push({
          from: depId,
          to: a.activityId,
          isCritical: criticalPathToggle && criticalPathSet.has(depId) && criticalPathSet.has(a.activityId),
        });
      }
    });
  });

  return { nodes, edges, positions, canvasWidth, canvasHeight };
}

function getCriticalPathSet(activities) {
  try {
    const { path } = getCriticalPath(activities);
    return new Set(path);
  } catch {
    return new Set();
  }
}

function renderSvg(container, activities) {
  const svgEl = document.getElementById("network-svg");
  const wrapper = container?.querySelector(".network-graph-wrapper");
  if (!svgEl || !wrapper || !activities.length) return;

  const criticalPathSet = getCriticalPathSet(activities);
  const { nodes, edges, positions, canvasWidth, canvasHeight } = computeLayout(activities, criticalPathSet);
  nodePositions = { ...positions };

  const xs = Object.values(positions).map((p) => p.x);
  const ys = Object.values(positions).map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) - NODE_WIDTH / 2 - 30 : 0;
  const minY = ys.length ? Math.min(...ys) - NODE_HEIGHT / 2 - 30 : 0;
  const width = xs.length ? Math.max(800, canvasWidth) : 800;
  const height = ys.length ? Math.max(450, canvasHeight) : 450;

  const arrowIdNormal = "arrow-normal";
  const arrowIdCritical = "arrow-critical";
  let edgesSvg = `
    <defs>
      <marker id="${arrowIdNormal}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#2f8fff" />
      </marker>
      <marker id="${arrowIdCritical}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#d9152e" />
      </marker>
    </defs>
  `;
  const rad = 6;
  edges.forEach((edge) => {
    const from = positions[edge.from];
    const to = positions[edge.to];
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const startX = from.x + ux * (NODE_WIDTH / 2 + rad);
    const startY = from.y + uy * (NODE_HEIGHT / 2 + rad);
    const endX = to.x - ux * (NODE_WIDTH / 2 + rad);
    const endY = to.y - uy * (NODE_HEIGHT / 2 + rad);
    const stroke = edge.isCritical ? "#d9152e" : "#2f8fff";
    const strokeWidth = edge.isCritical ? 2.5 : 1.5;
    const marker = edge.isCritical ? arrowIdCritical : arrowIdNormal;
    const pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
    edgesSvg += `<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${edge.isCritical ? 0.95 : 0.75}" stroke-linecap="round" marker-end="url(#${marker})" />`;
  });

  let nodesSvg = "";
  nodes.forEach((node) => {
    const pos = positions[node.id];
    if (!pos) return;
    const x = pos.x - NODE_WIDTH / 2;
    const y = pos.y - NODE_HEIGHT / 2;
    let fill = "#f6f9fe";
    let stroke = "#bfd0ea";
    if (node.isCritical) {
      fill = "rgba(217, 21, 46, 0.12)";
      stroke = "#d9152e";
    } else if (node.isBlocked) {
      fill = "rgba(255, 77, 99, 0.12)";
      stroke = "#ff4d63";
    }
    const lines = (node.label || node.id).split("\n");
    nodesSvg += `
      <g class="network-node" data-activity-id="${escapeHtml(node.id)}" transform="translate(${x},${y})">
        <rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
        <text x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT / 2 - 6}" text-anchor="middle" font-size="11" font-weight="600">${escapeHtml(lines[0] || node.id)}</text>
        <text x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT / 2 + 10}" text-anchor="middle" font-size="9" fill="#5f779c">${escapeHtml(lines[1] || "")}</text>
      </g>
    `;
  });

  const viewBoxX = Math.min(minX, 0);
  const viewBoxY = Math.min(minY, 0);
  const viewBoxW = Math.max(width, 800);
  const viewBoxH = Math.max(height, 450);
  svgEl.setAttribute("viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`);

  const hintX = viewBoxX + viewBoxW / 2;
  const hintY = viewBoxY + 28;
  const noLinksHint = edges.length === 0 ? `<g class="network-no-links-hint"><text x="${hintX}" y="${hintY}" text-anchor="middle" font-size="12" fill="#5f779c">No links — add Dependencies in Activity Master (e.g. ACT-025,ACT-026) to show relationships</text></g>` : "";
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", "500");
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgEl.style.minHeight = "500px";
  svgEl.style.maxHeight = "500px";
  svgEl.innerHTML = `<g class="edges">${edgesSvg}</g><g class="nodes">${nodesSvg}</g>${noLinksHint}`;
  svgEl.style.cursor = isPanning ? "grabbing" : "default";

  wrapper.querySelectorAll(".network-node").forEach((gEl) => {
    gEl.style.cursor = "pointer";
    gEl.addEventListener("click", (e) => {
      if (didDrag) return;
      const id = gEl.dataset.activityId;
      if (id) window.location.href = `activities.html?search=${encodeURIComponent(id)}`;
    });
    gEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      didDrag = false;
      draggedNodeId = gEl.dataset.activityId;
      const pt = svgEl.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgP = pt.matrixTransform(svgEl.getScreenCTM().inverse());
      const pos = nodePositions[draggedNodeId];
      if (pos) {
        dragOffsetX = svgP.x - pos.x;
        dragOffsetY = svgP.y - pos.y;
      }
    });
  });
}

function setupPanZoom(container) {
  const svgEl = document.getElementById("network-svg");
  const wrapper = container?.querySelector(".network-graph-wrapper");
  if (!svgEl || !wrapper) return;

  wrapper.addEventListener("mousedown", (e) => {
    if (e.target.closest(".network-node")) return;
    isPanning = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (draggedNodeId) {
      didDrag = true;
      const pt = svgEl.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgP = pt.matrixTransform(svgEl.getScreenCTM().inverse());
      const newX = svgP.x - dragOffsetX;
      const newY = svgP.y - dragOffsetY;
      nodePositions[draggedNodeId] = { x: newX, y: newY };
      const node = svgEl.querySelector(`.network-node[data-activity-id="${draggedNodeId}"]`);
      if (node) {
        node.setAttribute("transform", `translate(${newX - NODE_WIDTH / 2},${newY - NODE_HEIGHT / 2})`);
      }
    } else if (isPanning) {
      panX += e.clientX - lastPanX;
      panY += e.clientY - lastPanY;
      lastPanX = e.clientX;
      lastPanY = e.clientY;
      applyTransform();
    }
  });

  window.addEventListener("mouseup", () => {
    isPanning = false;
    draggedNodeId = null;
    setTimeout(() => { didDrag = false; }, 0);
    if (wrapper) wrapper.style.cursor = "grab";
  });

  wrapper.addEventListener("mouseleave", () => {
    isPanning = false;
    draggedNodeId = null;
  });

  wrapper.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoom = Math.max(0.3, Math.min(3, zoom + delta));
    applyTransform();
  });

  function applyTransform() {
    if (wrapper) {
      wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      wrapper.style.transformOrigin = "center center";
    }
  }

  const fitBtn = document.getElementById("network-fit-btn");
  if (fitBtn) {
    fitBtn.addEventListener("click", () => {
      zoom = 1;
      panX = 0;
      panY = 0;
      applyTransform();
    });
  }
}

function exportPng() {
  const svgEl = document.getElementById("network-svg");
  const container = document.getElementById("network-diagram");
  if (!svgEl || !container) return;

  const vb = svgEl.getAttribute("viewBox")?.split(/\s+/).map(Number) || [0, 0, 800, 500];
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = (vb[2] || 800) * scale;
  canvas.height = (vb[3] || 500) * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f6f9fe";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const svgData = new XMLSerializer().serializeToString(svgEl);
  const img = new Image();
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.download = `network-diagram_${new Date().toISOString().slice(0, 10)}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
    notify("Network diagram exported as PNG.", "success");
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    notify("Export failed.", "error");
  };
  img.src = url;
}

function exportSvg() {
  const svgEl = document.getElementById("network-svg");
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svgStr}`], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = `network-diagram_${new Date().toISOString().slice(0, 10)}.svg`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
  notify("Network diagram exported as SVG.", "success");
}

function render() {
  const activities = getActivities();
  const container = document.getElementById("network-diagram");
  if (!container) return;

  if (!activities.length) {
    container.innerHTML = '<div class="empty-state">No activities. Add activities in Activity Master.</div>';
    return;
  }

  const existingWrapper = container.querySelector(".network-graph-wrapper");
  if (!existingWrapper) {
    container.innerHTML = `
      <div class="network-graph-wrapper">
        <svg id="network-svg" class="network-svg"></svg>
      </div>
    `;
  }

  renderSvg(container, activities);
  setupPanZoom(container);
}

async function initialize() {
  await stateReady();
  const user = initializeAccessShell({});
  if (!user) return;
  initShell();
  initializeProjectToolbar({ mode: "switcher", onProjectChange: render });
  setActiveNavigation();

  const toggleEl = document.getElementById("network-critical-path-toggle");
  if (toggleEl) {
    toggleEl.checked = criticalPathToggle;
    toggleEl.addEventListener("change", () => {
      criticalPathToggle = toggleEl.checked;
      render();
    });
  }

  document.getElementById("network-export-png")?.addEventListener("click", exportPng);
  document.getElementById("network-export-svg")?.addEventListener("click", exportSvg);

  window.addEventListener("industrial_planning_state_changed", render);
  render();
}
initialize().catch((e) => console.error("[network] init:", e));
