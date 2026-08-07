const CACHE_NAME = "flor-mia-integral-v3";
const APP_SHELL = [
  "/",
  "/gestion",
  "/tienda",
  "/manifest.webmanifest",
  "/images/flor-mia/logo-flor-mia.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

function cacheResponse(request, response) {
  if (!response?.ok) return response;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  return response;
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => cacheResponse(event.request, response))
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  if (["script", "style"].includes(event.request.destination)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => cacheResponse(event.request, response))
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  if (!["font", "image"].includes(event.request.destination)) return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => cacheResponse(event.request, response)),
    ),
  );
});
