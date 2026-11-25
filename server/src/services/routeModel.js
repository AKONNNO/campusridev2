import { bearingDeg, projectToPolyline, computeCumulative } from '../lib/geo.js';
import { env } from '../config/env.js';

const { MIN_SPEED_KMH, AVG_DWELL_SECONDS } = env;

/**
 * RouteModel — the in-memory representation of a route's geometry + stops,
 * and the pure-maths engine behind the app's "core logic":
 *
 *  • SNAP-TO-ROUTE   every raw GPS point is projected onto the route polyline
 *                    (`snap`) and converted to a scalar "distanceAlong"
 *                    (metres from the start of the polyline). This removes
 *                    GPS jitter and lets us reason about the route in 1-D.
 *  • NEXT STOP       the first stop whose distanceAlong is ahead of the bus,
 *                    respecting travel direction and loop wrap-around.
 *  • ETA             remaining distance ÷ effective speed (floored at
 *                    MIN_SPEED_KMH) + AVG_DWELL_SECONDS for every stop the bus
 *                    still must dwell at before the target.
 *  • LOOP vs OUT-AND-BACK: loops wrap (distanceAlong resets); out-and-back
 *                    routes are traversed once forward and once reverse, so
 *                    the direction of travel (+1 / -1) decides stop order.
 *
 * The model is immutable; it is rebuilt from the DB whenever routes/stops
 * change (see services/routesCache.js).
 */
export class RouteModel {
  constructor({ id, name, code, colour, isLoop, isActive, path, stops = [] }) {
    this.id = id;
    this.name = name;
    this.code = code;
    this.colour = colour;
    this.isLoop = !!isLoop;
    this.isActive = isActive;

    // path: [{lat,lng}, ...] in travel order of the stored LineString.
    this.path = path;
    this.cumulative = computeCumulative(path); // cumulative[i] = metres to vertex i
    this.totalLength = this.cumulative[this.cumulative.length - 1] || 0;

    // stops: [{id, name, sequence, lat, lng, distanceAlong}] sorted by sequence.
    this.stops = [...stops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s) => ({
        id: s.id,
        name: s.name,
        sequence: s.sequence,
        lat: s.lat,
        lng: s.lng,
        distanceAlong: this.projectDistance(s.lat, s.lng),
      }));
    this.stopById = new Map(this.stops.map((s) => [s.id, s]));
  }

  /** Distance (metres) along the polyline of the point nearest to (lat,lng). */
  projectDistance(lat, lng) {
    const proj = projectToPolyline(lat, lng, this.path, this.cumulative);
    return proj ? proj.cumulativeM : 0;
  }

  /**
   * Snap a raw GPS point onto the route.
   * Returns { lat, lng, distanceAlong, heading, perpendicularM } or null.
   */
  snap(lat, lng) {
    const proj = projectToPolyline(lat, lng, this.path, this.cumulative);
    if (!proj) return null;
    const a = this.path[proj.index];
    const b = this.path[Math.min(proj.index + 1, this.path.length - 1)];
    const heading = bearingDeg(a.lat, a.lng, b.lat, b.lng);
    return {
      lat: proj.lat,
      lng: proj.lng,
      distanceAlong: proj.cumulativeM,
      heading,
      perpendicularM: proj.distM,
    };
  }

  /**
   * Inverse of snap(): given a distance-along-the-route, return the lat/lng
   * (and heading) at that point by walking the polyline's cumulative metres.
   * Used to place the smoothed bus position back onto the map.
   */
  pointAtDistance(distance) {
    const d = Math.max(0, Math.min(distance, this.totalLength));
    const n = this.path.length;
    for (let i = 0; i < n - 1; i += 1) {
      if (d <= this.cumulative[i + 1] || i === n - 2) {
        const segLen = this.cumulative[i + 1] - this.cumulative[i];
        const t = segLen > 0 ? (d - this.cumulative[i]) / segLen : 0;
        const a = this.path[i];
        const b = this.path[i + 1];
        return {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
          heading: bearingDeg(a.lat, a.lng, b.lat, b.lng),
        };
      }
    }
    const last = this.path[n - 1];
    return { lat: last.lat, lng: last.lng, heading: 0 };
  }

  includesStop(stopId) {
    return this.stopById.has(stopId);
  }

  getStop(stopId) {
    return this.stopById.get(stopId) || null;
  }

  /** Hysteresis epsilon (metres) used to decide what counts as "ahead". */
  static get EPS() {
    return 2;
  }

  /**
   * Remaining route distance (metres) from `fromM` to `toM` for a bus at
   * `fromM` travelling in `direction` (+1 forward, -1 reverse).
   * Loops wrap around; out-and-back is a plain difference in the travel
   * direction (always non-negative because the stops are ordered correctly).
   */
  remainingDistance(fromM, toM, direction) {
    if (this.isLoop) {
      let d = toM - fromM;
      if (d < 0) d += this.totalLength;
      return Math.max(0, d);
    }
    return direction >= 0
      ? Math.max(0, toM - fromM)
      : Math.max(0, fromM - toM);
  }

  /**
   * The ordered list of upcoming stops for a bus at `distanceAlong` travelling
   * in `direction`, limited to `count`.
   */
  serviceOrder(distanceAlong, direction, count) {
    const EPS = RouteModel.EPS;
    if (this.isLoop) {
      // Service order on a loop: everything ahead, then wrap to the start.
      const seq = [
        ...this.stops.filter((s) => s.distanceAlong > distanceAlong + EPS),
        ...this.stops.filter((s) => s.distanceAlong <= distanceAlong + EPS),
      ];
      return seq.slice(0, count);
    }
    if (direction >= 0) {
      // Forward (out-and-back): stops ahead in sequence order.
      return this.stops
        .filter((s) => s.distanceAlong > distanceAlong + EPS)
        .slice(0, count);
    }
    // Reverse: stops already passed are served again, in reverse order.
    const behind = this.stops.filter((s) => s.distanceAlong < distanceAlong - EPS);
    return behind.reverse().slice(0, count);
  }

  /**
   * Build the upcoming-stop plan for a bus: for each of the next `count` stops
   * returns { stopId, stopName, remainingM, etaSeconds, isNext }.
   * `speedKmh` is the bus's effective speed; it is floored at MIN_SPEED_KMH so
   * a stationary/full bus does not produce an absurd ETA.
   */
  arrivalPlan(distanceAlong, direction, speedKmh, count = 5) {
    const speedMs = Math.max(speedKmh, MIN_SPEED_KMH) / 3.6;
    const ordered = this.serviceOrder(distanceAlong, direction, count);
    return ordered.map((stop, i) => {
      const remaining = this.remainingDistance(distanceAlong, stop.distanceAlong, direction);
      // Stops strictly between the bus and this one each add a dwell period.
      const dwellSec = i * AVG_DWELL_SECONDS;
      return {
        stopId: stop.id,
        stopName: stop.name,
        sequence: stop.sequence,
        remainingM: Math.round(remaining),
        etaSeconds: Math.round(remaining / speedMs + dwellSec),
        isNext: i === 0,
      };
    });
  }

  /**
   * ETA for a bus at `fromM` to reach a specific stop (if that stop is still
   * served in the current direction), else null.
   */
  etaToStop(distanceAlong, direction, speedKmh, stopId) {
    const stop = this.getStop(stopId);
    if (!stop) return null;
    const plan = this.arrivalPlan(distanceAlong, direction, speedKmh, this.stops.length + 1);
    const match = plan.find((p) => p.stopId === stopId);
    return match ? match.etaSeconds : null;
  }

  /**
   * Estimated ride time (seconds) between two stops served by this route, in
   * the natural direction (forward unless the destination is "behind" the
   * pickup, which handles out-and-back routes). Includes dwell at intermediate
   * stops. Used by the trip planner.
   */
  rideTimeSeconds(fromStopId, toStopId, speedKmh) {
    const from = this.getStop(fromStopId);
    const to = this.getStop(toStopId);
    if (!from || !to || from.id === to.id) return null;

    const direction = from.distanceAlong < to.distanceAlong ? 1 : -1;
    const dist = this.remainingDistance(from.distanceAlong, to.distanceAlong, direction);

    // Count intermediate stops served between pickup and destination.
    let intermediate = 0;
    for (const s of this.stops) {
      if (s.id === from.id || s.id === to.id) continue;
      if (direction >= 0 && s.distanceAlong > from.distanceAlong && s.distanceAlong < to.distanceAlong) intermediate += 1;
      if (direction < 0 && s.distanceAlong < from.distanceAlong && s.distanceAlong > to.distanceAlong) intermediate += 1;
    }

    const speedMs = Math.max(speedKmh, MIN_SPEED_KMH) / 3.6;
    return Math.round(dist / speedMs + intermediate * AVG_DWELL_SECONDS);
  }
}

/** Build a RouteModel from a loaded DB row (see routesCache). */
export function buildRouteModel(row) {
  return new RouteModel(row);
}

