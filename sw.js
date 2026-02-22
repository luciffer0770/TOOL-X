const CACHE_NAME = "atlas-v3";
const BASE = self.location.pathname.replace(/\/[^/]*$/, "/") || "/";
const ASSETS = [
  "index.html",
  "login.html",
  "activities.html",
  "gantt.html",
  "materials.html",
  "intelligence.html",
  "anomaly-center.html",
  "css/styles.css",
  "js/auth.js",
  "js/common.js",
  "js/storage.js",
  "js/schema.js",
  "js/access-shell.js",
  "js/project-toolbar.js",
  "js/shell.js",
  "js/undo.js",
  "js/analytics.js",
  "js/dashboard.js",
  "js/gantt.js",
  "js/materials.js",
  "js/intelligence.js",
  "js/anomaly-center.js",
  "js/activities.js",
  "js/login.js",
].map((p) => new URL(p, self.location.origin + BASE).href);

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const isNav = e.request.mode === "navigate" || e.request.destination === "document";
  if (isNav) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => caches.match(e.request)))
  );
});
