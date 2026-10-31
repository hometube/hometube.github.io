// Transitional self-destructing service worker.
// The retired PWA left a caching service worker registered on user devices;
// with the old sw.js gone it could never update. Serving this script at the
// same URL makes browsers update to it, purge the old media/asset caches,
// reload open tabs, and unregister — after which it's gone for good.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of clients) {
        if ("navigate" in client) client.navigate(client.url);
      }
      await self.registration.unregister();
    })()
  );
});
