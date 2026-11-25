import { env } from '../config/env.js';
import { queryOne, execute } from '../config/db.js';
import { routesCache } from './routesCache.js';
import { AppError } from '../lib/AppError.js';

/**
 * LiveBusStore — the in-memory registry of buses that are currently on a trip.
 *
 * The spec deliberately keeps the latest positions in memory ("keep the latest
 * bus positions in memory" — no Redis needed for a handful of campus buses),
 * which also avoids a DB round-trip per GPS fix. History is still written to
 * bus_locations for reports / replay.
 *
 * Responsibilities:
 *   • register/unregister buses as trips start/end (driver app)
 *   • turn raw GPS fixes into clean, route-aware state:
 *       - GPS NOISE:  drop accuracy > MAX_ACCURACY_M and teleport jumps larger
 *                     than MAX_JUMP_M
 *       - SMOOTHING:  exponential moving average on distance-along so markers
 *                     glide instead of jittering
 *       - DIRECTION:  out-and-back routes flip +1/-1; loops are always +1
 *   • compute next stop + upcoming stops + ETAs (via RouteModel)
 *   • OFFLINE DETECTION: mark a bus offline after OFFLINE_AFTER_MS without
 *                        an update
 *   • emit bus:update / bus:offline / bus:ended for the socket layer
 */
export class LiveBusStore {
  constructor() {
    this.buses = new Map(); // busId -> live-bus state object
    this._events = new Map(); // eventName -> Set<listener>
    this._sweeper = null;
  }

  // ------------------------------------------------------------------ events
  on(event, listener) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event).add(listener);
    return () => this._events.get(event)?.delete(listener);
  }

  _emit(event, payload, ...rest) {
    for (const fn of this._events.get(event) || []) {
      try {
        fn(payload, ...rest);
      } catch {
        /* a broken listener must not stop the bus update */
      }
    }
  }

  // -------------------------------------------------------- offline sweeper
  startOfflineSweeper() {
    this.stopOfflineSweeper();
    this._sweeper = setInterval(() => this._detectOffline(), env.OFFLINE_SWEEP_MS);
    if (this._sweeper.unref) this._sweeper.unref(); // don't keep the process alive
  }

  stopOfflineSweeper() {
    if (this._sweeper) clearInterval(this._sweeper);
    this._sweeper = null;
  }

  /** Mark every bus offline if it has not reported for OFFLINE_AFTER_MS. */
  async _detectOffline() {
    const now = Date.now();
    for (const bus of this.buses.values()) {
      if (bus.status === 'offline') continue;
      if (now - bus.lastUpdate > env.OFFLINE_AFTER_MS) {
        bus.status = 'offline';
        bus.offlineAt = new Date().toISOString();
        this._emit('bus:offline', this.publicBus(bus));
        try {
          await execute("UPDATE buses SET status = 'offline' WHERE id = $1", [bus.busId]);
        } catch {
          /* reflect-only, non-fatal */
        }
      }
    }
  }

  // ------------------------------------------------------------- lifecycle
  /** Register a bus as it starts a trip (driver app → POST /driver/trip/start). */
  async startTrip({ driverId, driverName, busId, routeId }) {
    const busRow = await queryOne('SELECT id, bus_number, route_id FROM buses WHERE id = $1', [busId]);
    if (!busRow) throw AppError.notFound('Bus not found');

    const model = routesCache.getRoute(routeId || busRow.route_id);
    if (!model) throw AppError.badRequest('This bus is not assigned to an active route');

    // Reuse an already-open trip if one exists (e.g. after a server restart) —
    // drivers should not end up with two active trips for the same bus.
    let tripId = (
      await queryOne(
        "SELECT id FROM trips WHERE bus_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1",
        [busId]
      )
    )?.id;

    if (!tripId) {
      const inserted = await queryOne(
        `INSERT INTO trips (bus_id, driver_id, route_id, started_at, status)
         VALUES ($1, $2, $3, now(), 'active')
         RETURNING id`,
        [busId, driverId, model.id]
      );
      tripId = inserted.id;
    }

    await execute("UPDATE buses SET status = 'on_trip' WHERE id = $1", [busId]);

    const previous = this.buses.get(busId);
    this.buses.set(busId, {
      busId,
      busNumber: busRow.bus_number,
      routeId: model.id,
      model,
      tripId,
      driverId,
      driverName,
      status: 'on_trip',
      lat: previous?.lat ?? null,
      lng: previous?.lng ?? null,
      heading: 0,
      speedKmh: 0,
      rawSpeeds: [],
      distAlong: 0,
      prevDistAlong: null,
      smoothedDist: null,
      direction: 1, // out-and-back starts going forward
      plan: [],
      nextStop: null,
      lastUpdate: Date.now(),
      tripStartAt: new Date().toISOString(),
    });

    const bus = this.buses.get(busId);
    this._emit('bus:update', this.publicBus(bus));
    return bus;
  }

  /** Close the active trip for a bus and remove it from the live view. */
  async endTrip(busId) {
    // Normalise to a Number: `pg` returns BIGINT ids as strings, but the live
    // store keys buses by Number (see startTrip). Without this, a string id
    // would never match, the bus would never be removed from the live map and
    // it would just sit there until the offline sweeper marked it offline.
    const normalized = Number(busId);
    const current = this.buses.get(normalized);
    const tripId =
      current?.tripId ||
      (
        await queryOne(
          "SELECT id FROM trips WHERE bus_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1",
          [normalized]
        )
      )?.id;

    if (tripId) {
      await execute("UPDATE trips SET status = 'completed', ended_at = now() WHERE id = $1 AND status = 'active'", [tripId]);
    }
    await execute("UPDATE buses SET status = 'idle' WHERE id = $1", [normalized]);

    const removed = this.buses.get(normalized);
    this.buses.delete(normalized);
    this._emit('bus:ended', { busId: normalized, tripId }, removed ? this.publicBus(removed) : null);
    return { ok: true, tripId };
  }

  /** Update the driver-reported status (On route / Break / Breakdown / Full). */
  updateStatus(busId, status) {
    const bus = this.buses.get(Number(busId));
    if (!bus) throw AppError.notFound('Bus is not on an active trip');
    bus.status = status;
    this._emit('bus:update', this.publicBus(bus));
    return bus;
  }


  // ----------------------------------------------------------- GPS updates
  /**
   * Accept one GPS fix from a driver's phone and fold it into the bus state.
   *
   * Noise handling, smoothing and ETA math all happen here (see the class
   * comment). Returns the updated public payload, or null if the bus is not
   * registered (e.g. no active trip).
   */
  updateLocation(payload, busId) {
    const bus = this.buses.get(Number(busId));
    if (!bus) return null;

    const now = Date.now();
    bus.lastUpdate = now;

    // A bus that just started reporting again comes back online.
    if (bus.status === 'offline') {
      bus.status = 'on_trip';
      execute("UPDATE buses SET status = 'on_trip' WHERE id = $1", [bus.busId]).catch(() => {});
    }

    // ---- GPS noise: discard inaccurate fixes (accuracy > 50 m) ----
    if (payload.accuracy != null && payload.accuracy > env.MAX_ACCURACY_M) {
      return this.publicBus(bus); // keep the bus alive, just don't move it
    }

    const speed = Math.min(payload.speed ?? 0, env.MAX_SPEED_KMH);
    const model = bus.model;
    if (!model) return this.publicBus(bus);

    const snapped = model.snap(payload.lat, payload.lng);
    if (!snapped) return this.publicBus(bus);

    // ---- GPS noise: reject teleport jumps ----
    if (bus.smoothedDist != null) {
      let delta = snapped.distanceAlong - bus.smoothedDist;
      if (model.isLoop && delta < -model.totalLength / 2) delta += model.totalLength; // loop wrap
      if (Math.abs(delta) > env.MAX_JUMP_M) return this.publicBus(bus); // discard spike
    }

    // ---- Smoothing (EMA on distance-along) ----
    const alpha = 0.35;
    bus.smoothedDist =
      bus.smoothedDist == null ? snapped.distanceAlong : alpha * snapped.distanceAlong + (1 - alpha) * bus.smoothedDist;
    bus.distAlong = bus.smoothedDist;

    const pt = model.pointAtDistance(bus.smoothedDist);
    bus.lat = pt.lat;
    bus.lng = pt.lng;
    bus.heading = typeof payload.heading === 'number' ? payload.heading : pt.heading;

    // ---- Speed: moving average over the last SMOOTH_WINDOW readings ----
    bus.rawSpeeds.push(speed);
    if (bus.rawSpeeds.length > env.SMOOTH_WINDOW) bus.rawSpeeds.shift();
    bus.speedKmh = Math.round((bus.rawSpeeds.reduce((a, b) => a + b, 0) / bus.rawSpeeds.length) * 10) / 10;

    // ---- Direction (matters for out-and-back routes) ----
    if (!model.isLoop && bus.prevDistAlong != null && bus.prevDistAlong !== bus.distAlong) {
      const d = bus.distAlong - bus.prevDistAlong;
      if (Math.abs(d) > 1) bus.direction = d > 0 ? 1 : -1;
    }
    bus.prevDistAlong = bus.distAlong;

    // ---- Plan: next stop + upcoming stops + ETAs (speed floored inside) ----
    bus.plan = model.arrivalPlan(bus.distAlong, bus.direction, bus.speedKmh, 5);
    bus.nextStop = bus.plan.find((p) => p.isNext) || null;

    // ---- Persist history (async, must not block the live update) ----
    this._persistLocation(bus, payload, now);

    this._emit('bus:update', this.publicBus(bus));
    return this.publicBus(bus);
  }

  /** Write one accepted GPS fix to bus_locations for history/reports/replay. */
  _persistLocation(bus, payload, now) {
    const captured = payload.timestamp ? new Date(Number(payload.timestamp)) : new Date(now);
    execute(
      `INSERT INTO bus_locations
         (bus_id, trip_id, geom, lat, lng, speed_kmh, heading, accuracy, captured_at)
       VALUES
         ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), $3, $4, $5, $6, $7, $8)`,
      [
        bus.busId,
        bus.tripId,
        payload.lat,
        payload.lng,
        Math.min(payload.speed ?? 0, env.MAX_SPEED_KMH),
        payload.heading ?? null,
        payload.accuracy ?? null,
        captured,
      ]
    ).catch((err) => console.error('[liveStore] persist location failed:', err.message));
  }

  // ------------------------------------------------------------- queries
  /** Get the internal state object (driver/admin routes may need it). */
  getBus(busId) {
    return this.buses.get(Number(busId)) || null;
  }

  isLive(busId) {
    return this.buses.has(Number(busId));
  }

  /** Public list of all live (incl. offline-but-still-registered) buses. */
  getLiveBuses() {
    return [...this.buses.values()].map((b) => this.publicBus(b));
  }

  /** Live buses serving a given route (for the trip planner). */
  getBusesForRoute(routeId) {
    return [...this.buses.values()]
      .filter((b) => b.model && b.model.id === Number(routeId))
      .map((b) => this.publicBus(b));
  }

  /**
   * Buses that will still arrive at `stopId` in their current direction,
   * with ETA, sorted soonest first (student "stop arrivals" page).
   */
  arrivalsAtStop(stopId) {
    const result = [];
    for (const bus of this.buses.values()) {
      if (!bus.model || !bus.model.includesStop(stopId)) continue;
      const eta = bus.model.etaToStop(bus.distAlong, bus.direction, bus.speedKmh, stopId);
      if (eta == null) continue;
      const pub = this.publicBus(bus);
      result.push({ ...pub, etaSeconds: eta });
    }
    result.sort((a, b) => a.etaSeconds - b.etaSeconds);
    return result;
  }

  /** Clean, client-safe projection of a live bus. Never leaks driver info. */
  publicBus(bus) {
    return {
      busId: bus.busId,
      busNumber: bus.busNumber,
      tripId: bus.tripId,
      status: bus.status,
      lat: bus.lat,
      lng: bus.lng,
      heading: Math.round(bus.heading),
      speedKmh: bus.speedKmh,
      lastUpdate: new Date(bus.lastUpdate).toISOString(),
      route: bus.model
        ? { id: bus.model.id, name: bus.model.name, code: bus.model.code, colour: bus.model.colour }
        : null,
      nextStop: bus.nextStop || null,
      upcomingStops: bus.plan || [],
    };
  }
}

/** Single shared instance. */
export const liveBusStore = new LiveBusStore();

