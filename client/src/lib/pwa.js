/**
 * PWA service-worker registration + install-prompt helpers.
 *
 * `registerServiceWorker()` is called from main.jsx and only registers in
 * PRODUCTION builds (so Vite dev/HMR never fights the cache). The SW lives in
 * /public and is copied verbatim to dist/ — it precaches the app shell and
 * keeps public API data available offline.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return; // dev / preview-with-HMR: keep it simple

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Background-update flow: when a newer service worker finishes
        // installing (a new deploy), tell it to skipWaiting() so it takes
        // over on the next navigation — users always get the latest build
        // without a forced reload mid-session.
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed') {
              next.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((err) => {
        // Non-fatal — the app works fine without a service worker.
        console.warn('[pwa] service worker registration failed:', err);
      });
  });
}
