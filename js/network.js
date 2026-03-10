/** Network diagram - activity dependencies with graph layout, zoom, pan, drag, critical path, export */
import { escapeHtml, notify, setActiveNavigation } from "./common.js";
import { parseDependencies } from "./schema.js";
import { getActivities } from "./storage.js";
import { getBlockedActivities, getCriticalPath } from "./analytics.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { initializeAccessShell } from "./access-shell.js";
import { initShell } from "./shell.js";
import { stateReady } from "./storage.js";

const NODE_WIDTH = 140;
const NODE_HEIGHT = 48;

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

function getDagre() {
  if (typeof window.dagre !== "undefined") return window.dagre;
  return null;
}

function buildGraph(activities, criticalPathSet) {
  const byId = new Map(activities.map((a) => [a.activityId, a]));
  const blocked = new Set(getBlockedActivities(activities).map((a) => a.activityId));
  const g = getDagre()?.graphlib?.Graph ? new dagre.graphlib.Graph({ compound: true }) : null;

  if (!g) return null;

  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  activities.forEach((a) => {
    if (!a.activityId) return;
    const shortName = (a.activityName || "").slice(0, 20) + ((a.activityName || "").length > 20 ? "…" : "");
    g.setNode(a.activityId, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      label: `${a.activityId}\n${shortName}`,
      isBlocked: blocked.has(a.activityId),
      isCritical: criticalPathSet.has(a.activityId),
      activityId: a.activityId,
    });
  });

  activities.forEach((a) => {
    const deps = parseDependencies(a.dependencies);
    deps.forEach((depId) => {
      if (byId.has(depId) && byId.has(a.activityId)) {
        g.setEdge(depId, a.activityId);
      }
    });
  });

  return g;
}

function getCriticalPathSet(activities) {
  try {
    const { path } = getCriticalPath(activities);
    return new Set(path);
  } catch {
    return new Set();
  }
}

function applyLayout(g) {
  const dagreLib = getDagre();
  if (!dagreLib) return {};
  dagreLib.layout(g);
  const positions = {};
  g.nodes().forEach((id) => {
    const node = g.node(id);
    if (node) {
      positions[id] = { x: node.x, y: node.y };
    }
  });
  return positions;
}

function renderSvg(container, activities) {
  const svgEl = document.getElementById("network-svg");
  const wrapper = container?.querySelector(".network-graph-wrapper");
  if (!svgEl || !wrapper || !activities.length) return;

  const criticalPathSet = getCriticalPathSet(activities);
  const g = buildGraph(activities, criticalPathSet);

  if (!g || !getDagre()) {
    container.innerHTML = `
      <div class="network-graph-wrapper">
        <div class="empty-state">No activities. Add activities in Activity Master, or enable JavaScript for graph layout.</div>
      </div>
    `;
    return;
  }

  const positions = applyLayout(g);
  nodePositions = positions;

  const allNodes = g.nodes();
  const allEdges = g.edges();
  const criticalEdges = criticalPathToggle
    ? new Set(
        allEdges
          .filter((e) => criticalPathSet.has(e.v) && criticalPathSet.has(e.w))
          .map((e) => `${e.v}->${e.w}`),
      )
    : new Set();

  const xs = Object.values(positions).map((p) => p.x);
  const ys = Object.values(positions).map((p) => p.y);
  const minX = Math.min(...xs) - NODE_WIDTH / 2 - 20;
  const maxX = Math.max(...xs) + NODE_WIDTH / 2 + 20;
  const minY = Math.min(...ys) - NODE_HEIGHT / 2 - 20;
  const maxY = Math.max(...ys) + NODE_HEIGHT / 2 + 20;
  const width = Math.max(800, maxX - minX + 40);
  const height = Math.max(400, maxY - minY + 40);

  let edgesSvg = "";
  allEdges.forEach((e) => {
    const edge = g.edge(e);
    const points = edge?.points || [];
    const isCrit = criticalPathToggle && criticalEdges.has(`${e.v}->${e.w}`);
    const stroke = isCrit ? "#d9152e" : "#2f8fff";
    const strokeWidth = isCrit ? 2.5 : 1.2;
    if (points.length >= 2) {
      let pathD = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x} ${points[i].y}`;
      }
      edgesSvg += `<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${isCrit ? 0.9 : 0.6}" />`;
    }
  });

  let nodesSvg = "";
  allNodes.forEach((id) => {
    const node = g.node(id);
    if (!node) return;
    const x = node.x - NODE_WIDTH / 2;
    const y = node.y - NODE_HEIGHT / 2;
    const isBlocked = node.isBlocked;
    const isCritical = criticalPathToggle && node.isCritical;
    let fill = "#f6f9fe";
    let stroke = "#bfd0ea";
    if (isCritical) {
      fill = "rgba(217, 21, 46, 0.12)";
      stroke = "#d9152e";
    } else if (isBlocked) {
      fill = "rgba(255, 77, 99, 0.12)";
      stroke = "#ff4d63";
    }
    const lines = (node.label || id).split("\n");
    nodesSvg += `
      <g class="network-node" data-activity-id="${escapeHtml(id)}" transform="translate(${x},${y})">
        <rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
        <text x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT / 2 - 6}" text-anchor="middle" font-size="11" font-weight="600">${escapeHtml(lines[0] || id)}</text>
        <text x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT / 2 + 10}" text-anchor="middle" font-size="9" fill="#5f779c">${escapeHtml(lines[1] || "")}</text>
      </g>
    `;
  });

  svgEl.setAttribute("viewBox", `${minX - 20} ${minY - 20} ${width} ${height}`);
  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", "500");
  svgEl.innerHTML = `<g class="edges">${edgesSvg}</g><g class="nodes">${nodesSvg}</g>`;
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
      wrapper.style.transformOrigin = "0 0";
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

  const canvas = document.createElement("canvas");
  const rect = svgEl.getBoundingClientRect();
  const vb = svgEl.getAttribute("viewBox")?.split(/\s+/).map(Number) || [0, 0, 800, 500];
  const scale = 2;
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

  if (!getDagre()) {
    container.innerHTML = `
      <div class="network-graph-wrapper">
        <div class="empty-state">Graph layout library loading... Refresh if this persists.</div>
      </div>
    `;
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
  initializeProjectToolbar({ onProjectChange: render, onStateChange: render });
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
