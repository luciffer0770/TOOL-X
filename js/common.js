export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function setActiveNavigation() {
  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const isActive = href === page;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toISOString().slice(0, 10);
}

export function formatHours(value) {
  const number = Number(value) || 0;
  return `${Math.round(number * 10) / 10} h`;
}

export function formatCurrency(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(number);
}

export function statusClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("critical")) return "badge badge-critical";
  if (normalized.includes("high")) return "badge badge-high";
  if (normalized.includes("medium")) return "badge badge-medium";
  if (normalized.includes("delayed")) return "badge badge-critical";
  if (normalized.includes("blocked")) return "badge badge-high";
  if (normalized.includes("completed") || normalized.includes("received")) return "badge badge-good";
  if (normalized.includes("in progress") || normalized.includes("in transit")) return "badge badge-medium";
  return "badge badge-neutral";
}

export function safeText(value) {
  return String(value ?? "");
}

export function debounce(callback, waitMs = 300) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), waitMs);
  };
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csvRows = [headers.map(escape).join(",")];
  rows.forEach((row) => {
    csvRows.push(headers.map((header) => escape(row[header])).join(","));
  });
  return csvRows.join("\n");
}

export function triggerDownload(filename, content, mimeType = "text/plain;charset=utf-8;") {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export function notify(message, type = "info") {
  let host = document.querySelector("#toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-atomic", "true");
    document.body.appendChild(host);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 240);
  }, 2600);
}

export function renderEmptyState(target, message, suggestion = "") {
  const suggestionHtml = suggestion ? `<p class="empty-state-suggestion">${escapeHtml(suggestion)}</p>` : "";
  target.innerHTML = `<div class="empty-state">${escapeHtml(message)}${suggestionHtml}</div>`;
}

/**
 * Show a modal dialog. Returns a promise that resolves with the form data or user action.
 * @param {Object} options - { title, body, fields?, primaryLabel?, secondaryLabel?, danger? }
 * @returns {Promise<Object|null>}
 */
export function showModal(options = {}) {
  const {
    title = "Confirm",
    body = "",
    fields = [],
    primaryLabel = "Confirm",
    secondaryLabel = "Cancel",
    danger = false,
    defaultValue = "",
  } = options;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "modal-title");

  const fieldHtml = fields
    .map(
      (f) => `
    <label class="field">
      ${escapeHtml(f.label)}
      <input type="${f.type || "text"}" id="modal-${f.id}" value="${escapeHtml(f.value ?? defaultValue)}"
        placeholder="${escapeHtml(f.placeholder || "")}" ${f.required ? "required" : ""}
        maxlength="${f.maxLength ?? 200}" autocomplete="off" />
    </label>
  `,
    )
    .join("");

  overlay.innerHTML = `
    <div class="modal-dialog">
      <h2 id="modal-title" class="modal-title">${escapeHtml(title)}</h2>
      ${body ? `<p class="modal-body">${escapeHtml(body)}</p>` : ""}
      <div class="modal-fields">${fieldHtml}</div>
      <div class="modal-actions">
        <button type="button" class="modal-secondary ghost">${escapeHtml(secondaryLabel)}</button>
        <button type="button" class="modal-primary ${danger ? "danger" : ""}">${escapeHtml(primaryLabel)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const primaryBtn = overlay.querySelector(".modal-primary");
  const secondaryBtn = overlay.querySelector(".modal-secondary");
  const firstInput = overlay.querySelector("input");

  const close = () => {
    overlay.remove();
    document.body.style.overflow = "";
  };

  return new Promise((resolve) => {
    const submit = () => {
      const data = {};
      fields.forEach((f) => {
        const el = overlay.querySelector(`#modal-${f.id}`);
        if (el) data[f.id] = el.value?.trim() ?? "";
      });
      close();
      resolve(fields.length ? data : true);
    };

    primaryBtn.addEventListener("click", () => {
      if (fields.length) {
        const first = overlay.querySelector(`#modal-${fields[0].id}`);
        if (first?.value?.trim() === "" && fields[0].required) {
          first.focus();
          return;
        }
      }
      submit();
    });

    secondaryBtn.addEventListener("click", () => {
      close();
      resolve(null);
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        close();
        resolve(null);
      }
    });

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        resolve(null);
      }
      if (e.key === "Enter" && !e.target.matches("textarea")) {
        e.preventDefault();
        primaryBtn.click();
      }
    });

    document.body.style.overflow = "hidden";
    (firstInput || primaryBtn)?.focus();
  });
}

/**
 * Show loading overlay
 */
export function showLoading(message = "Loading...") {
  let el = document.querySelector("#loading-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "loading-overlay";
    el.className = "loading-overlay";
    el.innerHTML = '<div class="loading-spinner"></div><span class="loading-text"></span>';
    document.body.appendChild(el);
  }
  el.querySelector(".loading-text").textContent = message;
  el.classList.add("is-visible");
  return () => {
    el.classList.remove("is-visible");
  };
}
