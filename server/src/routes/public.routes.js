import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/AppError.js';
import { validate } from '../middleware/validate.js';
import { query, queryOne } from '../config/db.js';
import { routesCache } from '../services/routesCache.js';
import { liveBusStore } from '../services/liveStore.js';

/**
 * Public API — used by the student app and the map. No authentication.
 * PRIVACY: none of these endpoints ever receives or stores a student's
 * location; "nearest stop" queries are processed server-side and forgotten.
 */
const router = Router();

// --------------------------------------------------------------- /stops
/** GET /api/stops — all stops with coordinates. */
router.get(
  '/stops',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, name, code, ST_Y(geom) AS lat, ST_X(geom) AS lng
         FROM stops
        ORDER BY name`
    );
    res.json(rows);
  })
);

// -------------------------------------------------------------- /routes
/** GET /api/routes — every route with its polyline and stop list (for Leaflet). */
router.get(
  '/routes',
  asyncHandler(async (req, res) => {
    const models = routesCache.all;
    res.json(
      models.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        colour: m.colour,
        isLoop: m.isLoop,
        totalDistanceM: Math.round(m.totalLength),
        path: m.path,
        stops: m.stops.map((s) => ({
          id: s.id,
          name: s.name,
          sequence: s.sequence,
          lat: s.lat,
          lng: s.lng,
        })),
      }))
    );
  })
);

// ------------------------------------------------------------ /buses/live
/** GET /api/buses/live — current live list (fallback for WebSocket-less clients). */
router.get(
  '/buses/live',
  asyncHandler(async (req, res) => {
    res.json(liveBusStore.getLiveBuses());
  })
);

// ------------------------------------------------------- /stops/nearest
const nearestSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

/**
 * GET /api/stops/nearest?lat=&lng= — nearest stops to the given point.
 * Uses the PostGIS nearest_stops() function (KNN index-backed). The frontend
 * ALSO has a Haversine implementation for instant local ranking; this is the
 * authoritative, DB-backed answer.
 */
router.get(
  '/stops/nearest',
  validate(nearestSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { lat, lng, limit = 5 } = req.query;
    const rows = await query('SELECT * FROM nearest_stops($1, $2, $3)', [lat, lng, limit]);
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        distanceM: Math.round(r.distance_m),
        walkSeconds: Math.round(r.distance_m / 1.4), // assume 1.4 m/s walking
      }))
    );
  })
);

// ------------------------------------------------------ /stops/:id/arrivals
/** GET /api/stops/:id/arrivals — live buses arriving at this stop, soonest first. */
router.get(
  '/stops/:id/arrivals',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const stop = await queryOne('SELECT id, name, code FROM stops WHERE id = $1', [id]);
    if (!stop) throw AppError.notFound('Stop not found');

    res.json({
      stop,
      loadGeneratedAt: new Date().toISOString(),
      arrivals: liveBusStore.arrivalsAtStop(id),
    });
  })
);

// ----------------------------------------------------------- /trip-plan
const tripPlanSchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

/**
 * GET /api/trip-plan?from=stopId&to=stopId
 * Finds routes that serve both stops and, for each, the live buses that will
 * get you there: ETA to pickup + estimated ride time.
 */
router.get(
  '/trip-plan',
  validate(tripPlanSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    if (from === to) throw AppError.badRequest('Pickup and destination must differ');

    const [fromStop, toStop] = await Promise.all([
      queryOne('SELECT id, name, code FROM stops WHERE id = $1', [from]),
      queryOne('SELECT id, name, code FROM stops WHERE id = $1', [to]),
    ]);
    if (!fromStop || !toStop) throw AppError.notFound('One of the stops does not exist');

    const options = [];
    for (const model of routesCache.all) {
      if (!model.includesStop(from) || !model.includesStop(to)) continue;

      // Assumed planning speed when no bus is currently live on that route.
      const rideTime = model.rideTimeSeconds(from, to, 20);

      const liveBuses = liveBusStore
        .getBusesForRoute(model.id)
        .map((pub) => {
          const bus = liveBusStore.getBus(pub.busId);
          const etaToPickup = bus ? bus.model.etaToStop(bus.distAlong, bus.direction, bus.speedKmh, from) : null;
          const pubRide = bus ? bus.model.rideTimeSeconds(from, to, bus.speedKmh) : null;
          return {
            busId: pub.busId,
            busNumber: pub.busNumber,
            status: pub.status,
            etaToPickupSeconds: etaToPickup,
            rideTimeSeconds: pubRide,
          };
        })
        .filter((b) => b.etaToPickupSeconds != null); // only buses still serving the pickup

      options.push({
        route: { id: model.id, name: model.name, code: model.code, colour: model.colour },
        pickup: fromStop,
        destination: toStop,
        rideTimeSeconds: rideTime,
        buses: liveBuses,
        hasLiveBus: liveBuses.length > 0,
      });
    }

    if (options.length === 0) {
      res.json({ options: [], message: 'No single route serves both stops.' });
      return;
    }
    res.json({ options });
  })
);

// ------------------------------------------------------ /announcements
/** GET /api/announcements — active announcements (banner). */
router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, kind, title, message, created_at
         FROM announcements
        WHERE is_active = true
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC
        LIMIT 10`
    );
    res.json(rows);
  })
);

// --------------------------------------------------------- /feedback
const feedbackSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  contact: z.string().trim().max(120).optional(),
  stopId: z.coerce.number().int().positive().optional(),
  busId: z.coerce.number().int().positive().optional(),
});

/**
 * POST /api/feedback — a student feedback/report submission (no login; the
 * student app's Feedback tab). Validated + rate-limited; references to stops
 * or buses are checked so a bad id is a clean 404 rather than an FK crash.
 */
router.post(
  '/feedback',
  validate(feedbackSchema),
  asyncHandler(async (req, res) => {
    const { message, contact = null, stopId = null, busId = null } = req.body;

    if (stopId) {
      const stop = await queryOne('SELECT id FROM stops WHERE id = $1', [stopId]);
      if (!stop) throw AppError.notFound('That stop does not exist');
    }
    if (busId) {
      const bus = await queryOne('SELECT id FROM buses WHERE id = $1', [busId]);
      if (!bus) throw AppError.notFound('That bus does not exist');
    }

    const inserted = await queryOne(
      `INSERT INTO feedback (message, contact, stop_id, bus_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [message, contact, stopId, busId]
    );
    res.status(201).json({ ok: true, id: inserted.id });
  })
);

export default router;

