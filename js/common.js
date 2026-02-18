export function setActiveNavigation() {
  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.getAttribute("href") === page) {
      link.classList.add("is-active");
    } else {
      link.classList.remove("is-active");
    }
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(number);
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

export function renderEmptyState(target, message) {
  target.innerHTML = `<div class="empty-state">${safeText(message)}</div>`;
}
