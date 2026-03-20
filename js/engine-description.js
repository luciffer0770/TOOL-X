/**
 * Engine Description page – store and inspect engine requirement documents.
 * Upload Excel, Word, CSV; associate to project/engine/customer; parse and edit summaries.
 */
import { initPage } from "./page-init.js";
import { initializeProjectToolbar } from "./project-toolbar.js";
import { setActiveNavigation, notify, escapeHtml, debounce } from "./common.js";
import {
  getActiveProject,
  getEngineDocuments,
  addEngineDocument,
  updateEngineDocument,
  removeEngineDocument,
} from "./storage.js";

const MAX_FILE_SIZE_BASE64 = 2 * 1024 * 1024; // 2MB - skip base64 for larger files
const SUMMARY_KEYS = [
  "engineNameModel",
  "programProject",
  "customer",
  "requiredTools",
  "requiredMaterials",
  "preparationPhases",
  "keyMilestones",
  "dependencies",
  "notesSummary",
];

let selectedDocId = null;
let allDocs = [];

function getDefaultAssociation() {
  const project = getActiveProject();
  const config = project.projectConfig || {};
  return {
    engine: config.engineSerialNo || config.engineType || "",
    customer: config.customerOem || "",
  };
}

function parseExcelOrCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = typeof XLSX !== "undefined" ? XLSX.read(data, { type: "array" }) : null;
        if (!wb) {
          resolve({ text: "", summary: {} });
          return;
        }
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
        const text = json.map((row) => (Array.isArray(row) ? row.join("\t") : String(row))).join("\n");
        const summary = extractSummaryFromText(text);
        resolve({ text, summary });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function parseDocx(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      if (typeof mammoth === "undefined") {
        resolve({ text: "", summary: {} });
        return;
      }
      mammoth
        .extractRawText({ arrayBuffer })
        .then((result) => {
          const text = result.value || "";
          const summary = extractSummaryFromText(text);
          resolve({ text, summary });
        })
        .catch(reject);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function extractSummaryFromText(text) {
  const summary = {};
  const lower = text.toLowerCase();
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // Heuristics for common patterns
  const patterns = [
    { key: "engineNameModel", regex: /(?:engine|model)\s*[:\s]+([^\n]+)/i },
    { key: "programProject", regex: /(?:program|project)\s*[:\s]+([^\n]+)/i },
    { key: "customer", regex: /(?:customer|oem|client)\s*[:\s]+([^\n]+)/i },
    { key: "requiredTools", regex: /(?:tools?|equipment)\s*[:\s]+([^\n]+)/i },
    { key: "requiredMaterials", regex: /(?:materials?|parts?)\s*[:\s]+([^\n]+)/i },
    { key: "preparationPhases", regex: /(?:phases?|stages?)\s*[:\s]+([^\n]+)/i },
    { key: "keyMilestones", regex: /(?:milestones?)\s*[:\s]+([^\n]+)/i },
    { key: "dependencies", regex: /(?:dependencies?)\s*[:\s]+([^\n]+)/i },
  ];

  patterns.forEach(({ key, regex }) => {
    const m = text.match(regex);
    if (m) summary[key] = m[1].trim().slice(0, 500);
  });

  // First few lines often contain key info
  if (lines.length > 0 && !summary.notesSummary) {
    summary.notesSummary = lines.slice(0, 10).join(" ").slice(0, 800);
  }

  return summary;
}

async function handleFileUpload(file, engineId, customerId) {
  const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || "";
  let parsed = { text: "", summary: {} };

  try {
    if ([ "xlsx", "xls", "csv" ].includes(ext)) {
      parsed = await parseExcelOrCsv(file);
    } else if (ext === "docx") {
      parsed = await parseDocx(file);
    }
  } catch (err) {
    notify(`Parse warning: ${err.message}. File stored; you can edit the summary manually.`, "warning");
  }

  const project = getActiveProject();
  let fileDataBase64 = "";
  if (file.size < MAX_FILE_SIZE_BASE64) {
    try {
      fileDataBase64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result || "").replace(/^data:[^;]+;base64,/, ""));
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    } catch (_) {}
  }

  const doc = addEngineDocument({
    fileName: file.name,
    fileType: "." + ext,
    fileSize: file.size,
    projectId: project.id,
    engineId: (engineId || "").trim(),
    customerId: (customerId || "").trim(),
    fileDataBase64,
    summary: { ...parsed.summary },
  });

  notify(`Uploaded "${file.name}". Summary ${Object.keys(parsed.summary).length ? "parsed" : "empty – edit manually"}.`, "success");
  return doc;
}

function renderDocsList() {
  const tbody = document.getElementById("engine-docs-list");
  const searchEl = document.getElementById("engine-docs-search");
  const typeEl = document.getElementById("engine-docs-filter-type");
  if (!tbody) return;

  const search = (searchEl?.value || "").toLowerCase();
  const typeFilter = (typeEl?.value || "").toLowerCase();
  const project = getActiveProject();

  let filtered = getEngineDocuments();
  if (search) {
    filtered = filtered.filter(
      (d) =>
        (d.fileName || "").toLowerCase().includes(search) ||
        (d.engineId || "").toLowerCase().includes(search) ||
        (d.customerId || "").toLowerCase().includes(search),
    );
  }
  if (typeFilter) {
    filtered = filtered.filter((d) => (d.fileType || "").toLowerCase() === typeFilter);
  }

  allDocs = filtered;

  document.getElementById("engine-docs-summary").textContent = `${filtered.length} document(s)`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-cell">No documents. Upload Excel, Word, or CSV above.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (d) => `
    <tr class="engine-doc-row" data-doc-id="${escapeHtml(d.id)}">
      <td><strong>${escapeHtml(d.fileName || "—")}</strong> <span class="small">${escapeHtml(d.fileType || "")}</span></td>
      <td>${escapeHtml(project.name || project.id)}</td>
      <td>${escapeHtml(d.engineId || "—")}</td>
      <td>${escapeHtml(d.customerId || "—")}</td>
      <td class="small">${escapeHtml(formatDateShort(d.uploadedAt))}</td>
      <td class="cell-actions">
        <button type="button" class="ghost engine-doc-view" title="View / Edit summary">Summary</button>
        <button type="button" class="ghost engine-doc-remove danger" title="Remove">Remove</button>
      </td>
    </tr>
  `,
    )
    .join("");

  tbody.querySelectorAll(".engine-doc-view").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("tr");
      const id = row?.getAttribute("data-doc-id");
      if (id) openDetailPanel(id);
    });
  });
  tbody.querySelectorAll(".engine-doc-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const id = row?.getAttribute("data-doc-id");
      if (!id) return;
      if (confirm("Remove this document from the project?")) {
        removeEngineDocument(id);
        notify("Document removed.", "info");
        renderDocsList();
        if (selectedDocId === id) closeDetailPanel();
      }
    });
  });
}

function formatDateShort(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  } catch {
    return "—";
  }
}

function openDetailPanel(docId) {
  selectedDocId = docId;
  const docs = getEngineDocuments();
  const doc = docs.find((d) => d.id === docId);
  if (!doc) return;

  document.getElementById("engine-detail-panel").hidden = false;
  document.getElementById("engine-detail-filename").textContent = doc.fileName || "Document";

  const s = doc.summary || {};
  SUMMARY_KEYS.forEach((key) => {
    const el = document.getElementById(`summary-${key}`);
    if (el) el.value = s[key] || "";
  });
}

function closeDetailPanel() {
  selectedDocId = null;
  document.getElementById("engine-detail-panel").hidden = true;
}

function saveSummary() {
  if (!selectedDocId) return;
  const summary = {};
  SUMMARY_KEYS.forEach((key) => {
    const el = document.getElementById(`summary-${key}`);
    if (el) summary[key] = (el.value || "").trim();
  });
  updateEngineDocument(selectedDocId, { summary });
  notify("Summary saved.", "success");
}

function refresh() {
  renderDocsList();
  if (selectedDocId) {
    const doc = getEngineDocuments().find((d) => d.id === selectedDocId);
    if (doc) openDetailPanel(selectedDocId);
    else closeDetailPanel();
  }
}

function init() {
  initPage({
    requireAuth: true,
    onProjectChange: refresh,
    onReady() {
      setActiveNavigation();
      initializeProjectToolbar({ onProjectChange: refresh });

      const def = getDefaultAssociation();
      const engineInput = document.getElementById("engine-associate-engine");
      const customerInput = document.getElementById("engine-associate-customer");
      if (engineInput) engineInput.placeholder = def.engine ? `Default: ${def.engine}` : "Engine ID or serial";
      if (customerInput) customerInput.placeholder = def.customer ? `Default: ${def.customer}` : "Customer name";

      const uploadInput = document.getElementById("engine-upload-input");
      const dropZone = document.getElementById("engine-upload-drop-zone");

      uploadInput?.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        const engine = (document.getElementById("engine-associate-engine")?.value || "").trim() || def.engine;
        const customer = (document.getElementById("engine-associate-customer")?.value || "").trim() || def.customer;
        for (const file of files) {
          if (/\.(xlsx|xls|csv|docx)$/i.test(file.name)) {
            await handleFileUpload(file, engine, customer);
          }
        }
        e.target.value = "";
        renderDocsList();
      });

      dropZone?.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add("drag-over");
      });
      dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
      dropZone?.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove("drag-over");
        const files = Array.from(e.dataTransfer?.files || []);
        const engine = (document.getElementById("engine-associate-engine")?.value || "").trim() || def.engine;
        const customer = (document.getElementById("engine-associate-customer")?.value || "").trim() || def.customer;
        for (const file of files) {
          if (/\.(xlsx|xls|csv|docx)$/i.test(file.name)) {
            await handleFileUpload(file, engine, customer);
          }
        }
        renderDocsList();
      });

      document.getElementById("engine-docs-search")?.addEventListener("input", debounce(renderDocsList, 200));
      document.getElementById("engine-docs-filter-type")?.addEventListener("change", renderDocsList);

      document.getElementById("engine-detail-save-btn")?.addEventListener("click", saveSummary);
      document.getElementById("engine-detail-close-btn")?.addEventListener("click", closeDetailPanel);

      renderDocsList();
    },
    onStateChange: refresh,
  });
}

init();
