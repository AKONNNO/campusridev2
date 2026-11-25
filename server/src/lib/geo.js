/**
 * Geo helpers (great-circle + local equirectangular projection).
 * These mirror the SQL-side helpers so the server and the DB agree on maths.
 * All functions take (lat, lng) in decimal degrees and return metres/degrees.
 */

const EARTH_RADIUS_M = 6371008.8;
export const toRad = (deg) => (deg * Math.PI) / 180;
export const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance between two lat/lng points, in metres (Haversine). */
export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Distance in kilometres (convenience for API responses). */
export function haversineKm(lat1, lng1, lat2, lng2) {
  return haversineM(lat1, lng1, lat2, lng2) / 1000;
}

/** Initial bearing from point A to point B, in degrees [0, 360). */
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Walking speed assumption used for "nearest stop" walking-time estimates (m/s). */
export const WALK_SPEED_MS = 1.4;
export function walkSecondsMeters(metres) {
  return metres / WALK_SPEED_MS;
}

/**
 * Project a point onto a line SEGMENT defined by two endpoints.
 *
 * Projection is done in a local equirectangular space (metres) around the
 * point itself, which is accurate for segments a few hundred metres long.
 *
 * Returns:
 *   { t, distM, x, y }
 *   t     — fraction along the segment [0,1] of the closest point
 *   distM — perpendicular distance from the point to the segment (metres)
 *   x, y  — equirectangular coords of the closest point (east, north) in metres
 */
export function projectToSegment(lat, lng, aLat, aLng, bLat, bLng, refLat) {
  const metersPerDegLat = 111132.92;
  const metersPerDegLng = metersPerDegLat * Math.cos(toRad(refLat));

  const px = lng * metersPerDegLng;
  const py = lat * metersPerDegLat;
  const ax = aLng * metersPerDegLng;
  const ay = aLat * metersPerDegLat;
  const bx = bLng * metersPerDegLng;
  const by = bLat * metersPerDegLat;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;

  const lenSq = abx * abx + aby * aby;
  let t = 0; // closest point = A when segment is degenerate
  if (lenSq > 1e-12) {
    t = (apx * abx + apy * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }

  const cx = ax + t * abx; // closest point
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  const distM = Math.sqrt(dx * dx + dy * dy);

  return { t, distM, x: cx, y: cy };
}

/**
 * Project a point onto a POLYLINE (array of { lat, lng }).
 * Returns:
 *   { index, t, distM, lat, lng, cumulativeM }
 *   index       — index of the closest segment's start vertex
 *   t           — fraction along that segment
 *   distM       — perpendicular distance from the point to the polyline
 *   lat, lng    — snapped point
 *   cumulativeM — distance along the polyline to the snapped point
 * `cumulative` (optional) is a precomputed array of cumulative distances where
 * cumulative[i] = distance to vertex i. If omitted it is computed here.
 */
export function projectToPolyline(lat, lng, vertices, cumulative) {
  const n = vertices.length;
  if (n === 0) return null;
  if (n === 1) {
    const { lat: vLat, lng: vLng } = vertices[0];
    return {
      index: 0,
      t: 0,
      distM: haversineM(lat, lng, vLat, vLng),
      lat: vLat,
      lng: vLng,
      cumulativeM: 0,
    };
  }

  const refLat = lat; // projection scale reference
  const cum = cumulative || computeCumulative(vertices);
  let best = null;
  let bestDist = Infinity;

  for (let i = 0; i < n - 1; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const proj = projectToSegment(lat, lng, a.lat, a.lng, b.lat, b.lng, refLat);
    if (proj.distM < bestDist) {
      bestDist = proj.distM;
      // Convert local equirect coords back to lat/lng for the snapped point.
      const metersPerDegLat = 111132.92;
      const metersPerDegLng = metersPerDegLat * Math.cos(toRad(refLat));
      best = {
        index: i,
        t: proj.t,
        distM: proj.distM,
        lat: proj.y / metersPerDegLat,
        lng: proj.x / metersPerDegLng,
        cumulativeM: cum[i] + proj.t * (cum[i + 1] - cum[i]),
      };
    }
  }
  return best;
}

/** Compute cumulative distance (metres) along a polyline of {lat,lng} vertices. */
export function computeCumulative(vertices) {
  const cum = [0];
  for (let i = 1; i < vertices.length; i += 1) {
    const prev = vertices[i - 1];
    const cur = vertices[i];
    cum.push(cum[i - 1] + haversineM(prev.lat, prev.lng, cur.lat, cur.lng));
  }
  return cum;
}
