/**
 * Tiny localStorage cache for offline use.
 * The student app saves stops + routes so the map still renders when the
 * device is offline (spec: "no internet connection — show cached stops and
 * routes").
 */
export function saveCache(key, data) {
  try {
    localStorage.setItem(`knust_cache_${key}`, JSON.stringify(data));
  } catch {
    /* storage full / private mode */
  }
}

export function loadCache(key) {
  try {
    const raw = localStorage.getItem(`knust_cache_${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const CACHE_STOPS = 'stops';
export const CACHE_ROUTES = 'routes';
export const CACHE_BUSES = 'buses';

export function cachesForOffline(stops, routes) {
  saveCache(CACHE_STOPS, stops);
  saveCache(CACHE_ROUTES, routes);
}
