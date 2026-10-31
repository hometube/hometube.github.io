// Legacy entry point from the retired PWA's cached HTML. Registers the
// self-destructing worker at /sw.js (which clears caches and unregisters)
// and unregisters defensively if that script ever disappears again.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((reg) => reg.update())
    .catch(() => {});
}
