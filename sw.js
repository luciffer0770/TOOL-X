const CACHE_NAME = "industrial-planning-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/activities.html",
  "/gantt.html",
  "/materials.html",
  "/intelligence.html",
  "/anomaly-center.html",
  "/css/styles.css",
  "/js/auth.js",
  "/js/common.js",
  "/js/storage.js",
  "/js/schema.js",
  "/js/access-shell.js",
  "/js/project-toolbar.js",
  "/js/shell.js",
  "/js/undo.js",
];

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
  if (e.request.url.startsWith("http") && !e.request.url.includes("localhost") && !e.request.url.includes("127.0.0.1")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
