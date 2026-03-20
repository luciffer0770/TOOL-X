import { escapeHtml, notify, setActiveNavigation } from "./common.js";
import { initPage } from "./page-init.js";
import { canImportExportData, getAuthBearerHeaders } from "./auth.js";
import {
  deleteEngineDocument,
  getActiveProject,
  getMergedEngineSummary,
  upsertEngineDocument,
} from "./storage.js";
import { SUMMARY_KEYS, parseEngineFile } from "./engine-doc-parse.js";

let currentUser = null;
let selectedId = null;
let useBackend = false;

const LABELS = {
  engineNameModel: "Engine name / model",
  programProject: "Program / project",
  customer: "Customer",
  requiredTools: "Required tools",
  requiredMaterials: "Required materials",
  preparationPhases: "Preparation phases",
  keyMilestones: "Key milestones",
  dependencies: "Dependencies",
  notesSummary: "Notes / requirements summary",
};

async function checkBackend() {
  try {
    const r = await fetch("/api/health");
    useBackend = r.ok;
  } catch {
    useBackend = false;
  }
  const hint = document.querySelector("#ed-backend-hint");
  if (hint) {
    hint.textContent = useBackend
      ? "Signed-in server sessions store original files for download. Metadata and summaries sync with project state."
      : "Static mode: summaries are saved; upload binary storage requires the Python backend and API login.";
  }
}

function listDocs() {
  return getActiveProject().engineDocuments || [];
}

function filteredDocs() {
  const q = (document.querySelector("#ed-search")?.value || "").trim().toLowerCase();
  const st = document.querySelector("#ed-filter-status")?.value || "";
  return listDocs().filter((d) => {
    if (st === "failed") {
      if (d.parseStatus !== "failed" && d.parseStatus !== "manual") return false;
    } else if (st && d.parseStatus !== st) return false;
    if (!q) return true;
    const merged = getMergedEngineSummary(d);
    const blob = [d.fileName, d.customer, d.engineRef, d.projectRef, ...Object.values(merged)]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
}

function renderTable() {
  const body = document.querySelector("#ed-doc-body");
  if (!body) return;
  const rows = filteredDocs();
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="text-muted">No documents match filters.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((d) => {
      const tag = `${escapeHtml(d.customer || "—")} · ${escapeHtml(d.engineRef || "—")}`;
      return `<tr data-id="${escapeHtml(d.id)}" class="ed-doc-row${selectedId === d.id ? " is-selected" : ""}">
        <td><button type="button" class="ed-link-btn" data-select="${escapeHtml(d.id)}">${escapeHtml(d.fileName || "Untitled")}</button></td>
        <td class="small">${escapeHtml((d.uploadedAt || "").slice(0, 19).replace("T", " "))}</td>
        <td><span class="badge ed-parse-badge ed-parse-${escapeHtml(d.parseStatus || "none")}">${escapeHtml(d.parseStatus || "none")}</span></td>
        <td class="small">${tag}</td>
        <td>${d.blobId ? '<span class="small text-muted">Server</span>' : '<span class="small text-muted">Meta only</span>'}</td>
      </tr>`;
    })
    .join("");

  body.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedId = btn.getAttribute("data-select");
      renderTable();
      renderDetail();
    });
  });
}

function renderDetail() {
  const panel = document.querySelector("#ed-detail-panel");
  const doc = listDocs().find((d) => d.id === selectedId);
  if (!panel) return;
  if (!doc) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const title = document.querySelector("#ed-detail-title");
  const sub = document.querySelector("#ed-detail-sub");
  if (title) title.textContent = doc.fileName || "Requirement summary";
  if (sub)
    sub.textContent = `Parse: ${doc.parseStatus || "none"}${doc.blobId ? " · file on server" : ""}`;

  const note = document.querySelector("#ed-parse-note");
  if (note) {
    if (doc.parseNote) {
      note.hidden = false;
      note.textContent = doc.parseNote;
    } else {
      note.hidden = true;
    }
  }

  const grid = document.querySelector("#ed-summary-fields");
  if (!grid) return;
  const merged = getMergedEngineSummary(doc);
  const manual = doc.summaryManual || {};
  const canEdit = canImportExportData(currentUser);

  const tagBlock = `<div class="form-grid ed-tag-grid">
    <label class="field">Customer tag <input type="text" id="ed-tag-customer" value="${escapeHtml(doc.customer || "")}" ${
    canEdit ? "" : "readonly"
  } /></label>
    <label class="field">Engine ref <input type="text" id="ed-tag-engine" value="${escapeHtml(doc.engineRef || "")}" ${
    canEdit ? "" : "readonly"
  } /></label>
    <label class="field">Program ref <input type="text" id="ed-tag-project" value="${escapeHtml(doc.projectRef || "")}" ${
    canEdit ? "" : "readonly"
  } /></label>
  </div>`;

  const fieldsBlock = SUMMARY_KEYS.map((key) => {
    const val = merged[key] || "";
    const man = manual[key] || "";
    return `<label class="field ed-summary-field">
      <span class="ed-field-label">${escapeHtml(LABELS[key] || key)}</span>
      <textarea class="ed-summary-textarea" data-k="${escapeHtml(key)}" rows="3" ${canEdit ? "" : "readonly"}>${escapeHtml(
      man || val,
    )}</textarea>
      <span class="small text-muted">Manual entry overrides parsed text for this field when saved.</span>
    </label>`;
  }).join("");

  grid.innerHTML = tagBlock + fieldsBlock;
}

async function uploadFiles(fileList) {
  if (!canImportExportData(currentUser)) {
    notify("Your role cannot upload requirement documents.", "warning");
    return;
  }
  const project = getActiveProject();
  const files = [...fileList];
  for (const file of files) {
    const parsed = await parseEngineFile(file);
    let blobId = "";
    if (useBackend && getAuthBearerHeaders().Authorization) {
      try {
        const fd = new FormData();
        fd.append("project_id", project.id);
        fd.append("file", file, file.name);
        const r = await fetch("/api/engine-docs", { method: "POST", headers: getAuthBearerHeaders(), body: fd });
        const data = await r.json();
        if (data?.ok && data.id) blobId = data.id;
        else notify(data?.error || "Upload failed", "error");
      } catch (e) {
        notify("Upload failed: " + (e?.message || e), "error");
      }
    } else if (useBackend && !getAuthBearerHeaders().Authorization) {
      notify("Sign in through the server (not offline demo) to store original files.", "info");
    }

    const summary = { ...parsed.summary };
    let parseStatus = parsed.parseStatus;
    if (parseStatus === "ok" && parsed.parseNote) parseStatus = "partial";

    upsertEngineDocument({
      id: `EDOC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      uploadedAt: new Date().toISOString(),
      blobId,
      customer: project.setup?.customerOem || "",
      engineRef: [project.setup?.engineType, project.setup?.engineSerialNo].filter(Boolean).join(" ") || "",
      projectRef: project.setup?.projectCode || project.name || "",
      summary,
      summaryManual: {},
      parseStatus,
      parseNote: parsed.parseNote || "",
    });
    notify(`Imported ${file.name} (${parseStatus}).`, parseStatus === "failed" ? "warning" : "success");
  }
  renderTable();
  renderDetail();
}

async function downloadSelected() {
  const doc = listDocs().find((d) => d.id === selectedId);
  if (!doc?.blobId) {
    notify("No server file attached to this record.", "info");
    return;
  }
  try {
    const r = await fetch(`/api/engine-docs/${encodeURIComponent(doc.blobId)}`, { headers: getAuthBearerHeaders() });
    if (!r.ok) throw new Error("Download failed");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName || "document";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    notify(String(e?.message || e), "error");
  }
}

function saveManual() {
  const doc = listDocs().find((d) => d.id === selectedId);
  if (!doc) return;
  const summaryManual = {};
  document.querySelectorAll(".ed-summary-textarea").forEach((ta) => {
    const k = ta.dataset.k;
    if (k) summaryManual[k] = ta.value.trim();
  });
  upsertEngineDocument({
    ...doc,
    customer: document.querySelector("#ed-tag-customer")?.value?.trim() ?? doc.customer,
    engineRef: document.querySelector("#ed-tag-engine")?.value?.trim() ?? doc.engineRef,
    projectRef: document.querySelector("#ed-tag-project")?.value?.trim() ?? doc.projectRef,
    summaryManual,
    parseStatus: "manual",
  });
  notify("Summary overrides saved.", "success");
  renderTable();
  renderDetail();
}

async function deleteSelected() {
  const doc = listDocs().find((d) => d.id === selectedId);
  if (!doc) return;
  if (doc.blobId && getAuthBearerHeaders().Authorization) {
    try {
      await fetch(`/api/engine-docs/${encodeURIComponent(doc.blobId)}`, {
        method: "DELETE",
        headers: { ...getAuthBearerHeaders(), "Content-Type": "application/json" },
      });
    } catch (_) {}
  }
  deleteEngineDocument(doc.id);
  selectedId = null;
  notify("Document removed.", "success");
  renderTable();
  renderDetail();
}

function wire() {
  const input = document.querySelector("#ed-file-input");
  const zone = document.querySelector("#ed-drop-zone");

  input?.addEventListener("change", () => {
    if (input.files?.length) uploadFiles(input.files);
    input.value = "";
  });

  zone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-dragover");
  });
  zone?.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
  zone?.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-dragover");
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  document.querySelector("#ed-search")?.addEventListener("input", () => renderTable());
  document.querySelector("#ed-filter-status")?.addEventListener("change", () => renderTable());
  document.querySelector("#ed-download-btn")?.addEventListener("click", () => downloadSelected());
  document.querySelector("#ed-save-manual-btn")?.addEventListener("click", () => saveManual());
  document.querySelector("#ed-delete-btn")?.addEventListener("click", () => deleteSelected());
}

function initialize() {
  setActiveNavigation();
  wire();
  checkBackend().then(() => {
    initPage({
      requireAuth: true,
      onReady(user) {
        currentUser = user;
        if (!currentUser) return;
        renderTable();
        renderDetail();
      },
      onProjectChange() {
        selectedId = null;
        renderTable();
        renderDetail();
      },
      onStateChange() {
        renderTable();
        renderDetail();
      },
    }).catch((e) => console.error("[engine-description]", e));
  });
}

initialize();
