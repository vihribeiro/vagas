/* Service worker — online-first para dados, cache para o app shell.
   O ?v=26 abaixo precisa acompanhar o ASSET_VERSION do app/main.py. */
const CACHE = "vagas-shell-v26";
const V = "?v=26";
const SHELL = [
  "/",
  "/login",
  "/curriculo",
  "/static/style.css" + V,
  "/static/i18n.js" + V,
  "/static/theme.js" + V,
  "/static/app.js" + V,
  "/static/swipe.js" + V,
  "/static/detail.js" + V,
  "/static/cv.js" + V,
  "/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dados da API: sempre online-first, sem cache.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: "offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }

  // App shell e páginas: tenta a rede, cai para o cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("/")))
  );
});