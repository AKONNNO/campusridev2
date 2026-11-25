/**
 * Client-side geo helpers (Haversine, bearing, nearest-stop ranking).
 * Mirrors the server's math so "nearest stop" responds instantly on-device;
 * the server's PostGIS query is still used as the authoritative fallback.
 */

const R = 6371008.8;
export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;

export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Average walking speed used for "time to nearest stop". */
export const WALK_SPEED_MS = 1.4;

/** Humanised walking text, e.g. "320 m · 4 min walk". */
export function walkText(distanceM) {
  if (distanceM == null) return null;
  const min = Math.max(1, Math.round(distanceM / (WALK_SPEED_MS * 60)));
  if (distanceM < 1000) return `${Math.round(distanceM)} m · ~${min} min walk`;
  return `${(distanceM / 1000).toFixed(1)} km · ~${min} min walk`;
}

/**
 * Rank stops by distance to (lat, lng) using straight-line Haversine.
 * (The campus is small; straight-line ≈ walking distance is a fine estimate.)
 */
export function nearestStops(stops, lat, lng, limit = 5) {
  return stops
    .map((s) => ({ ...s, distanceM: haversineM(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/** Point → which stop along a route is nearest (for trip-planner sanity). */
export function distanceBetween(aLat, aLng, bLat, bLng) {
  return haversineM(aLat, aLng, bLat, bLng);
}
