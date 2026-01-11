const CACHE_NAME = "image-loop-player-v4";
const ASSETS = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return undefined;
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const req = event.request;
  const isNavigation = req.mode === "navigate";

  if (isNavigation) {
    // network-first for HTML to avoid stale app shell
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", respClone).catch(() => {}));
          return resp;
        })
        .catch(async () => {
          const cached = await caches.match("/");
          return cached || Response.error();
        }),
    );
    return;
  }

  // cache-first for static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone).catch(() => {}));
          return resp;
        })
        .catch(() => cached);
    }),
  );
});
