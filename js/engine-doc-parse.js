/**
 * Best-effort parsing of requirement spreadsheets and text for Engine Description summaries.
 * Partial results are expected; callers should set parseStatus accordingly.
 */

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

function emptySummary() {
  return SUMMARY_KEYS.reduce((acc, k) => {
    acc[k] = "";
    return acc;
  }, {});
}

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Map label text to summary field key */
function labelToField(label) {
  const L = norm(label);
  if (!L) return null;
  if (/^engine|^model|^engine\s*type|^type/.test(L)) return "engineNameModel";
  if (/program|project\s*name|^project$/.test(L)) return "programProject";
  if (/customer|oem|client/.test(L)) return "customer";
  if (/tool/.test(L)) return "requiredTools";
  if (/material/.test(L)) return "requiredMaterials";
  if (/phase|preparation/.test(L)) return "preparationPhases";
  if (/milestone/.test(L)) return "keyMilestones";
  if (/depend/.test(L)) return "dependencies";
  if (/note|summary|requirement|remark|scope/.test(L)) return "notesSummary";
  return null;
}

function mergeValue(target, field, value) {
  const v = String(value ?? "").trim();
  if (!v || !field) return;
  if (!target[field]) target[field] = v;
  else if (!target[field].includes(v)) target[field] = `${target[field]}; ${v}`;
}

/**
 * Parse first sheet of an Excel workbook (global XLSX from SheetJS).
 * @param {ArrayBuffer} arrayBuffer
 */
export function parseEngineSpreadsheet(arrayBuffer) {
  const summary = emptySummary();
  let parseNote = "";
  try {
    if (typeof XLSX === "undefined" || !arrayBuffer) {
      return { summary, parseStatus: "failed", parseNote: "Sheet parser unavailable." };
    }
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { summary, parseStatus: "partial", parseNote: "Workbook has no sheets." };
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    let matched = 0;
    rows.forEach((row) => {
      if (!Array.isArray(row) || row.length < 2) return;
      const a = String(row[0] ?? "").trim();
      const b = String(row[1] ?? "").trim();
      const field = labelToField(a);
      if (field && b) {
        mergeValue(summary, field, b);
        matched++;
      }
    });
    if (matched === 0 && rows.length) {
      parseNote = "No labeled rows detected; fill summary manually or adjust sheet layout (label column A, value column B).";
      const flat = rows
        .flat()
        .map((c) => String(c ?? "").trim())
        .filter(Boolean)
        .slice(0, 80);
      if (flat.length) summary.notesSummary = flat.join(" | ").slice(0, 4000);
    }
    return {
      summary,
      parseStatus: matched > 0 ? "ok" : rows.length ? "partial" : "failed",
      parseNote,
    };
  } catch (e) {
    return { summary, parseStatus: "failed", parseNote: String(e?.message || e) };
  }
}

/**
 * Parse CSV / plain text: lines like "Label: value" or tab-separated.
 */
export function parseEngineText(text) {
  const summary = emptySummary();
  if (!text || !String(text).trim()) {
    return { summary, parseStatus: "failed", parseNote: "Empty document." };
  }
  const lines = String(text).split(/\r?\n/);
  let matched = 0;
  lines.forEach((line) => {
    const m = line.match(/^([^:|\t]+)[:|\t]\s*(.+)$/);
    if (m) {
      const field = labelToField(m[1]);
      if (field) {
        mergeValue(summary, field, m[2]);
        matched++;
      }
    }
  });
  if (matched === 0) {
    summary.notesSummary = String(text).trim().slice(0, 8000);
    return {
      summary,
      parseStatus: "partial",
      parseNote: "Structured labels not found; raw text placed in notes summary for manual cleanup.",
    };
  }
  return { summary, parseStatus: "ok", parseNote: "" };
}

/**
 * @param {File} file
 * @returns {Promise<{ summary: object, parseStatus: string, parseNote: string }>}
 */
export async function parseEngineFile(file) {
  const name = (file?.name || "").toLowerCase();
  const ext = name.split(".").pop() || "";

  if (ext === "csv" || ext === "txt") {
    const text = await file.text();
    return parseEngineText(text);
  }

  if (ext === "xlsx" || ext === "xls") {
    const buf = await file.arrayBuffer();
    return parseEngineSpreadsheet(buf);
  }

  if (ext === "docx") {
    if (typeof mammoth === "undefined") {
      return {
        summary: emptySummary(),
        parseStatus: "failed",
        parseNote: "Word parser not loaded.",
      };
    }
    const buf = await file.arrayBuffer();
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      const text = result.value || "";
      const out = parseEngineText(text);
      if (result.messages?.length) {
        out.parseNote = [out.parseNote, ...result.messages.map((m) => m.message)].filter(Boolean).join(" ");
      }
      return out;
    } catch (e) {
      return {
        summary: emptySummary(),
        parseStatus: "failed",
        parseNote: String(e?.message || e),
      };
    }
  }

  return {
    summary: emptySummary(),
    parseStatus: "failed",
    parseNote: "Unsupported file type for auto-parse.",
  };
}

export { SUMMARY_KEYS };
