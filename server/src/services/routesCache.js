import { query } from '../config/db.js';
import { RouteModel } from './routeModel.js';

/**
 * routesCache — keeps ALL active routes materialised as RouteModel instances
 * in memory. Driving the navigation maths from a DB query on every GPS fix
 * would be wasteful; here we load once at boot and refresh:
 *   • on demand (after admin edits routes/stops),
 *   • and on a slow timer as a safety net.
 *
 * Route data is small (a few routes × hundreds of vertices), so holding it in
 * memory is the right call — there is no need for Redis for this.
 */
class RoutesCache {
  constructor() {
    this.models = new Map(); // routeId -> RouteModel
    this.loading = null;
  }

  /** Load all active routes (with stops) and rebuild the model map. */
  async refresh() {
    const routeRows = await query(
      `SELECT r.id, r.name, r.code, r.colour, r.is_loop, r.is_active,
              ST_AsGeoJSON(r.path_geom) AS path_json
         FROM routes r
        WHERE r.is_active = true
        ORDER BY r.id`
    );

    const stopRows = await query(
      `SELECT rs.route_id, rs.sequence, s.id AS stop_id, s.name, s.code,
              ST_Y(s.geom) AS lat, ST_X(s.geom) AS lng
         FROM route_stops rs
         JOIN stops s ON s.id = rs.stop_id
        ORDER BY rs.route_id, rs.sequence`
    );

    const byRoute = new Map();
    for (const row of stopRows) {
      if (!byRoute.has(row.route_id)) byRoute.set(row.route_id, []);
      byRoute.get(row.route_id).push({
        id: row.stop_id,
        name: row.name,
        code: row.code,
        sequence: row.sequence,
        lat: row.lat,
        lng: row.lng,
      });
    }

    const next = new Map();
    for (const r of routeRows) {
      const path = this.parsePathGeoJSON(r.path_json);
      if (!path || path.length < 2) continue; // skip routes with no drivable path
      // Normalise ids to NUMBERS: Postgres BIGINT/`pg` returns BIGSERIAL ids as
      // strings, while every lookup elsewhere uses Number ids (getRoute,
      // getBusesForRoute, includesStop, etaToStop...). Without this, the
      // Map.get()/Map.has() lookups and strict `===` comparisons would never
      // match and no route would ever resolve to a live bus.
      next.set(
        Number(r.id),
        new RouteModel({
          id: Number(r.id),
          name: r.name,
          code: r.code,
          colour: r.colour,
          isLoop: r.is_loop,
          isActive: r.is_active,
          path,
          stops: (byRoute.get(r.id) || []).map((s) => ({
            ...s,
            id: Number(s.id),
            sequence: Number(s.sequence),
          })),
        })
      );
    }

    this.models = next;
    return next;
  }

  /**
   * GeoJSON LineString coordinates are [[lng,lat],...] — convert to the
   * {lat,lng} vertices the model expects.
   */
  parsePathGeoJSON(json) {
    try {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json;
      if (!parsed || parsed.type !== 'LineString') return null;
      return parsed.coordinates.map(([lng, lat]) => ({ lat, lng }));
    } catch {
      return null;
    }
  }

  getRoute(routeId) {
    return this.models.get(Number(routeId)) || null;
  }

  get all() {
    return [...this.models.values()];
  }
}

/** Single shared instance. */
export const routesCache = new RoutesCache();

/** Start the safety-net timer (idempotent). */
export function startRoutesRefreshTimer(intervalMs = 60000) {
  setInterval(async () => {
    try {
      await routesCache.refresh();
    } catch (err) {
      // Non-fatal: keep serving the previous snapshot.
      console.error('[routesCache] background refresh failed:', err.message);
    }
  }, intervalMs);
}
