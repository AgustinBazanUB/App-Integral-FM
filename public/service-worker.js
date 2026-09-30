const surface = new URL(self.location.href).searchParams.get("surface") || "unified";
const CACHE_NAME = `flor-mia-${surface}-v3`;
const APP_SHELL_BY_SURFACE = {
  gestion: ["/", "/gestion", "/manifest.gestion.webmanifest"],
  ecommerce: ["/", "/productos", "/manifest.ecommerce.webmanifest"],
  unified: ["/", "/gestion", "/tienda", "/manifest.webmanifest"],
};
const APP_SHELL = [
  ...(APP_SHELL_BY_SURFACE[surface] || APP_SHELL_BY_SURFACE.unified),
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

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/")),
    );
    return;
  }
  if (!["style", "script", "font", "image"].includes(event.request.destination)) return;
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }),
    ),
  );
});
