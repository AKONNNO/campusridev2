import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/AppError.js';
import { validate } from '../middleware/validate.js';
import { protect, requireRole } from '../middleware/auth.js';
import { query, queryOne, execute, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { routesCache } from '../services/routesCache.js';

/**
 * Admin routes — authenticated (JWT), admin role only.
 * Full CRUD for buses, drivers, routes, stops and announcements, plus
 * trip history / reports. After any change that affects route geometry or
 * stop ordering, routesCache.refresh() keeps the navigation maths current.
 */
const router = Router();
router.use(protect, requireRole('admin'));

// ============================================================== Buses
/** GET /api/admin/buses */
router.get(
  '/buses',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT b.id, b.bus_number AS "busNumber", b.model, b.capacity, b.colour, b.status,
              b.route_id AS "routeId", r.name AS "routeName", r.colour AS "routeColour"
         FROM buses b
         LEFT JOIN routes r ON r.id = b.route_id
        ORDER BY b.bus_number`
    );
    res.json(rows);
  })
);

const busBodySchema = z.object({
  busNumber: z.string().trim().min(1).max(20),
  model: z.string().trim().max(60).optional(),
  capacity: z.coerce.number().int().min(1).max(200).optional(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  routeId: z.coerce.number().int().positive().nullable().optional(),
});

/** POST /api/admin/buses */
router.post(
  '/buses',
  validate(busBodySchema),
  asyncHandler(async (req, res) => {
    const { busNumber, model = 'Coaster', capacity = 18, colour = null, routeId = null } = req.body;
    const inserted = await queryOne(
      `INSERT INTO buses (bus_number, model, capacity, colour, route_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [busNumber, model, capacity, colour, routeId]
    );
    res.status(201).json({ ok: true, bus: inserted });
  })
);

/** PUT /api/admin/buses/:id */
router.put(
  '/buses/:id',
  validate(busBodySchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const bus = await queryOne('SELECT * FROM buses WHERE id = $1', [id]);
    if (!bus) throw AppError.notFound('Bus not found');

    const merged = { ...bus, ...req.body };
    await execute(
      `UPDATE buses
          SET bus_number = $2, model = $3, capacity = $4, colour = $5, route_id = $6
        WHERE id = $1`,
      [id, merged.busNumber, merged.model, merged.capacity, merged.colour, merged.routeId ?? null]
    );
    res.json({ ok: true });
  })
);

/** DELETE /api/admin/buses/:id */
router.delete(
  '/buses/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const affected = await execute('DELETE FROM buses WHERE id = $1', [id]);
    if (!affected) throw AppError.notFound('Bus not found');
    res.json({ ok: true });
  })
);

// ============================================================= Drivers
/** GET /api/admin/drivers — joined with the user + assigned bus. */
router.get(
  '/drivers',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT d.id, d.license_number AS "licenseNumber",
              d.assigned_bus_id AS "assignedBusId",
              u.id AS "userId", u.name, u.phone, u.is_active AS active,
              b.bus_number AS "busNumber"
         FROM drivers d
         JOIN users u ON u.id = d.user_id
         LEFT JOIN buses b ON b.id = d.assigned_bus_id
        ORDER BY u.name`
    );
    res.json(rows);
  })
);

const driverCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(5).max(20),
  pin: z.string().min(4).max(64),
  licenseNumber: z.string().trim().max(40).optional(),
  assignedBusId: z.coerce.number().int().positive().nullable().optional(),
});

/**
 * POST /api/admin/drivers — creates the user (bcrypt PIN) + driver row.
 * All in one transaction so a failure can't leave a half-created account.
 */
router.post(
  '/drivers',
  validate(driverCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, phone, pin, licenseNumber = null, assignedBusId = null } = req.body;
    const pinHash = await bcrypt.hash(pin, env.BCRYPT_ROUNDS);

    const result = await withTransaction(async (client) => {
      const userRes = await client.query(
        `INSERT INTO users (name, phone, pin_hash, role) VALUES ($1, $2, $3, 'driver') RETURNING id`,
        [name, phone, pinHash]
      );
      const driverRes = await client.query(
        `INSERT INTO drivers (user_id, license_number, assigned_bus_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [userRes.rows[0].id, licenseNumber, assignedBusId]
      );
      return { userId: userRes.rows[0].id, driverId: driverRes.rows[0].id };
    });

    res.status(201).json({ ok: true, ...result });
  })
);

const driverUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().min(5).max(20).optional(),
  pin: z.string().min(4).max(64).optional(),
  licenseNumber: z.string().trim().max(40).nullable().optional(),
  assignedBusId: z.coerce.number().int().positive().nullable().optional(),
  isActive: z.coerce.boolean().optional(),
});

/** PUT /api/admin/drivers/:id — update profile, PIN, bus assignment, active flag. */
router.put(
  '/drivers/:id',
  validate(driverUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const driver = await queryOne('SELECT id, user_id FROM drivers WHERE id = $1', [id]);
    if (!driver) throw AppError.notFound('Driver not found');

    await withTransaction(async (client) => {
      const sets = [];
      const params = [driver.user_id];
      if (req.body.name !== undefined) { params.push(req.body.name); sets.push(`name = $${params.length}`); }
      if (req.body.phone !== undefined) { params.push(req.body.phone); sets.push(`phone = $${params.length}`); }
      if (req.body.isActive !== undefined) { params.push(req.body.isActive); sets.push(`is_active = $${params.length}`); }
      if (req.body.pin) {
        const pinHash = await bcrypt.hash(req.body.pin, env.BCRYPT_ROUNDS);
        params.push(pinHash);
        sets.push(`pin_hash = $${params.length}`);
      }
      if (sets.length) {
        await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
      }

      const driverSets = [];
      const driverParams = [id];
      if (req.body.licenseNumber !== undefined) { driverParams.push(req.body.licenseNumber); driverSets.push(`license_number = $${driverParams.length}`); }
      if (req.body.assignedBusId !== undefined) { driverParams.push(req.body.assignedBusId); driverSets.push(`assigned_bus_id = $${driverParams.length}`); }
      if (driverSets.length) {
        await client.query(`UPDATE drivers SET ${driverSets.join(', ')} WHERE id = $1`, driverParams);
      }
    });

    res.json({ ok: true });
  })
);

/** DELETE /api/admin/drivers/:id — removes driver + their user account. */
router.delete(
  '/drivers/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const driver = await queryOne('SELECT id, user_id FROM drivers WHERE id = $1', [id]);
    if (!driver) throw AppError.notFound('Driver not found');
    await execute('DELETE FROM users WHERE id = $1', [driver.user_id]); // cascades to drivers
    res.json({ ok: true });
  })
);


// ============================================================== Routes
/** GET /api/admin/routes — full detail incl. path + ordered stops. */
router.get(
  '/routes',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT r.id, r.name, r.code, r.colour, r.is_loop AS "isLoop", r.is_active AS "isActive",
              r.total_distance_m AS "totalDistanceM", ST_AsGeoJSON(r.path_geom) AS "pathJson"
         FROM routes r
        ORDER BY r.code`
    );
    const stopRows = await query(
      `SELECT rs.route_id AS "routeId", rs.sequence, s.id AS "stopId", s.name, s.code,
              ST_Y(s.geom) AS lat, ST_X(s.geom) AS lng
         FROM route_stops rs
         JOIN stops s ON s.id = rs.stop_id
        ORDER BY rs.route_id, rs.sequence`
    );
    const byRoute = new Map();
    for (const s of stopRows) {
      if (!byRoute.has(s.routeId)) byRoute.set(s.routeId, []);
      byRoute.get(s.routeId).push(s);
    }
    res.json(
      rows.map((r) => ({
        ...r,
        path:
          r.pathJson && r.pathJson !== 'null'
            ? JSON.parse(r.pathJson).coordinates.map(([lng, lat]) => ({ lat, lng }))
            : [],
        stops: byRoute.get(r.id) || [],
        pathJson: undefined,
      }))
    );
  })
);

const routeCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(10),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0ea5e9'),
  isLoop: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2).optional(),
  stops: z.array(z.object({ stopId: z.number().int().positive(), sequence: z.number().int().positive() })).optional(),
});

/** POST /api/admin/routes — create with optional drawn/GeoJSON path + stops. */
router.post(
  '/routes',
  validate(routeCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, code, colour, isLoop, isActive, coordinates, stops = [] } = req.body;
    const geojson = coordinates ? buildLineStringGeojson(coordinates) : null;

    const inserted = await queryOne(
      `INSERT INTO routes (name, code, colour, is_loop, is_active, path_geom, total_distance_m)
       SELECT $1, $2, $3, $4, $5,
              ${geojson ? "ST_Segmentize(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), 0.0006)," : 'NULL,'}
              ${geojson ? 'ST_Length(ST_Segmentize(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), 0.0006)::geography)' : 'NULL'}
       RETURNING id`,
      [name, code, colour, isLoop, isActive, geojson || null]
    );

    await replaceRouteStops(inserted.id, stops);
    await routesCache.refresh();
    res.status(201).json({ ok: true, routeId: inserted.id });
  })
);


const routeUpdateSchema = routeCreateSchema.partial();

/** PUT /api/admin/routes/:id — update fields, optional new path or stops. */
router.put(
  '/routes/:id',
  validate(routeUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const route = await queryOne('SELECT id FROM routes WHERE id = $1', [id]);
    if (!route) throw AppError.notFound('Route not found');

    const geojson = req.body.coordinates ? buildLineStringGeojson(req.body.coordinates) : null;
    const { stops, coordinates, ...fields } = req.body;

    const sets = [];
    const params = [id];
    if (fields.name !== undefined) { params.push(fields.name); sets.push(`name = $${params.length}`); }
    if (fields.code !== undefined) { params.push(fields.code); sets.push(`code = $${params.length}`); }
    if (fields.colour !== undefined) { params.push(fields.colour); sets.push(`colour = $${params.length}`); }
    if (fields.isLoop !== undefined) { params.push(fields.isLoop); sets.push(`is_loop = $${params.length}`); }
    if (fields.isActive !== undefined) { params.push(fields.isActive); sets.push(`is_active = $${params.length}`); }
    if (geojson) {
      params.push(geojson);
      sets.push(
        `path_geom = ST_Segmentize(ST_SetSRID(ST_GeomFromGeoJSON($${params.length}), 4326), 0.0006),
         total_distance_m = ST_Length(ST_Segmentize(ST_SetSRID(ST_GeomFromGeoJSON($${params.length}), 4326), 0.0006)::geography)`
      );
    }
    if (sets.length) {
      await execute(`UPDATE routes SET ${sets.join(', ')} WHERE id = $1`, params);
    }
    if (stops) await replaceRouteStops(id, stops);

    await routesCache.refresh();
    res.json({ ok: true });
  })
);

/** PUT /api/admin/routes/:id/geojson — import a full GeoJSON LineString path. */
router.put(
  '/routes/:id/geojson',
  validate(z.object({ geojson: z.string().min(2).max(200000) })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const route = await queryOne('SELECT id FROM routes WHERE id = $1', [id]);
    if (!route) throw AppError.notFound('Route not found');

    const geom = req.body.geojson; // a GeoJSON LineString or Feature string
    await execute(
      `UPDATE routes
          SET path_geom = ST_Segmentize(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 0.0006),
              total_distance_m = ST_Length(ST_Segmentize(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 0.0006)::geography)
        WHERE id = $1`,
      [id, geom]
    );
    await routesCache.refresh();
    res.json({ ok: true });
  })
);

/** PUT /api/admin/routes/:id/stops — replace the ordered stop list (drag-to-reorder). */
router.put(
  '/routes/:id/stops',
  validate(
    z.object({
      stops: z.array(z.object({ stopId: z.number().int().positive(), sequence: z.number().int().positive() })).min(1),
    })
  ),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const route = await queryOne('SELECT id FROM routes WHERE id = $1', [id]);
    if (!route) throw AppError.notFound('Route not found');

    await replaceRouteStops(id, req.body.stops);
    await routesCache.refresh();
    res.json({ ok: true });
  })
);

/** DELETE /api/admin/routes/:id */
router.delete(
  '/routes/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const affected = await execute('DELETE FROM routes WHERE id = $1', [id]);
    if (!affected) throw AppError.notFound('Route not found');
    await routesCache.refresh();
    res.json({ ok: true });
  })
);


// =============================================================== Stops
/** GET /api/admin/stops */
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

const stopSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().max(20).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

/** POST /api/admin/stops — create a stop (admin clicks the map for lat/lng). */
router.post(
  '/stops',
  validate(stopSchema),
  asyncHandler(async (req, res) => {
    const { name, code = null, lat, lng } = req.body;
    const inserted = await queryOne(
      `INSERT INTO stops (name, code, geom) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)) RETURNING id`,
      [name, code, lat, lng]
    );
    res.status(201).json({ ok: true, stopId: inserted.id });
  })
);

/** PUT /api/admin/stops/:id */
router.put(
  '/stops/:id',
  validate(stopSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const stop = await queryOne('SELECT id FROM stops WHERE id = $1', [id]);
    if (!stop) throw AppError.notFound('Stop not found');

    const sets = [];
    const params = [id];
    if (req.body.name !== undefined) { params.push(req.body.name); sets.push(`name = $${params.length}`); }
    if (req.body.code !== undefined) { params.push(req.body.code); sets.push(`code = $${params.length}`); }
    if (req.body.lat !== undefined && req.body.lng !== undefined) {
      params.push(req.body.lat, req.body.lng);
      sets.push(`geom = ST_SetSRID(ST_MakePoint($${params.length}, $${params.length - 1}), 4326)`);
    }
    if (sets.length) await execute(`UPDATE stops SET ${sets.join(', ')} WHERE id = $1`, params);

    await routesCache.refresh();
    res.json({ ok: true });
  })
);

/** DELETE /api/admin/stops/:id — also removes it from any route_stops (cascade). */
router.delete(
  '/stops/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const used = await queryOne('SELECT id FROM route_stops WHERE stop_id = $1 LIMIT 1', [id]);
    if (used) throw AppError.conflict('Stop is used by a route — remove it from all routes first');
    const affected = await execute('DELETE FROM stops WHERE id = $1', [id]);
    if (!affected) throw AppError.notFound('Stop not found');
    await routesCache.refresh();
    res.json({ ok: true });
  })
);

// ========================================================= Announcements
const announcementSchema = z.object({
  kind: z.enum(['delay', 'breakdown', 'schedule', 'info']),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(2000),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** POST /api/admin/announcements — create + push to all clients (socket event). */
router.post(
  '/announcements',
  validate(announcementSchema),
  asyncHandler(async (req, res) => {
    const { kind, title, message, expiresAt = null } = req.body;
    const inserted = await queryOne(
      `INSERT INTO announcements (kind, title, message, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, kind, title, message, created_at`,
      [kind, title, message, req.user.id, expiresAt]
    );
    // Real-time push to every connected student / driver.
    const io = req.app.get('io');
    if (io) io.emit('announcement:new', inserted);
    res.status(201).json({ ok: true, announcement: inserted });
  })
);

const announcementUpdateSchema = z.object({
  kind: z.enum(['delay', 'breakdown', 'schedule', 'info']).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
  isActive: z.coerce.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** PATCH /api/admin/announcements/:id — edit or deactivate. */
router.patch(
  '/announcements/:id',
  validate(announcementUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await queryOne('SELECT id FROM announcements WHERE id = $1', [id]);
    if (!existing) throw AppError.notFound('Announcement not found');

    const sets = [];
    const params = [id];
    if (req.body.kind !== undefined) { params.push(req.body.kind); sets.push(`kind = $${params.length}`); }
    if (req.body.title !== undefined) { params.push(req.body.title); sets.push(`title = $${params.length}`); }
    if (req.body.message !== undefined) { params.push(req.body.message); sets.push(`message = $${params.length}`); }
    if (req.body.isActive !== undefined) { params.push(req.body.isActive); sets.push(`is_active = $${params.length}`); }
    if (req.body.expiresAt !== undefined) { params.push(req.body.expiresAt); sets.push(`expires_at = $${params.length}`); }
    if (sets.length) await execute(`UPDATE announcements SET ${sets.join(', ')} WHERE id = $1`, params);

    res.json({ ok: true });
  })
);

/** DELETE /api/admin/announcements/:id */
router.delete(
  '/announcements/:id',
  asyncHandler(async (req, res) => {
    const affected = await execute('DELETE FROM announcements WHERE id = $1', [Number(req.params.id)]);
    if (!affected) throw AppError.notFound('Announcement not found');
    res.json({ ok: true });
  })
);


// ======================================================= Reports / history
/**
 * GET /api/admin/reports/summary — trips per day (7d), busiest stops (by GPS
 * hits within 150 m), and average completed-trip duration (minutes).
 */
router.get(
  '/reports/summary',
  asyncHandler(async (req, res) => {
    const [tripsPerDay, busiestStops, durationInfo] = await Promise.all([
      query(
        `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day, count(*) AS trips
           FROM trips
          WHERE started_at >= now() - interval '7 days'
          GROUP BY 1 ORDER BY 1`
      ),
      query(
        `SELECT s.id, s.name, count(bl.id) AS "gpsHits"
           FROM stops s
           LEFT JOIN bus_locations bl ON ST_DWithin(s.geom::geography, bl.geom::geography, 150)
          GROUP BY s.id, s.name
          ORDER BY "gpsHits" DESC, s.name
          LIMIT 10`
      ),
      queryOne(
        `SELECT count(*) AS "completedTrips",
                avg(extract(epoch FROM (ended_at - started_at))) / 60 AS "avgDurationMinutes"
           FROM trips
          WHERE status = 'completed' AND ended_at IS NOT NULL`
      ),
    ]);
    res.json({ tripsPerDay, busiestStops, durationInfo });
  })
);

/** GET /api/admin/trips — recent trips with vehicle/driver/route, for history. */
router.get(
  '/trips',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT t.id, t.started_at AS "startedAt", t.ended_at AS "endedAt", t.status,
              b.bus_number AS "busNumber",
              u.name AS "driverName",
              r.name AS "routeName", r.colour AS "routeColour",
              round(extract(epoch FROM (t.ended_at - t.started_at)) / 60) AS "durationMinutes"
         FROM trips t
         JOIN buses b ON b.id = t.bus_id
         LEFT JOIN drivers d ON d.id = t.driver_id
         LEFT JOIN users u ON u.id = d.user_id
         LEFT JOIN routes r ON r.id = t.route_id
        ORDER BY t.started_at DESC
        LIMIT 200`
    );
    res.json(rows);
  })
);

/** GET /api/admin/trips/:id/locations — ordered GPS points for map replay. */
router.get(
  '/trips/:id/locations',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const trip = await queryOne('SELECT id FROM trips WHERE id = $1', [id]);
    if (!trip) throw AppError.notFound('Trip not found');

    const points = await query(
      `SELECT id, lat, lng, speed_kmh AS speed, heading, captured_at AS t
         FROM bus_locations
        WHERE trip_id = $1
        ORDER BY captured_at ASC`,
      [id]
    );
    res.json({ tripId: id, points });
  })
);

// ============================================================= Feedback
/** GET /api/admin/feedback — student feedback/reports, newest first. */
router.get(
  '/feedback',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT f.id, f.message, f.contact, f.created_at AS "createdAt",
              s.name AS "stopName", b.bus_number AS "busNumber"
         FROM feedback f
         LEFT JOIN stops s ON s.id = f.stop_id
         LEFT JOIN buses b ON b.id = f.bus_id
        ORDER BY f.created_at DESC
        LIMIT 200`
    );
    res.json(rows);
  })
);

/** DELETE /api/admin/feedback/:id — remove a submission (already actioned). */
router.delete(
  '/feedback/:id',
  asyncHandler(async (req, res) => {
    const affected = await execute('DELETE FROM feedback WHERE id = $1', [Number(req.params.id)]);
    if (!affected) throw AppError.notFound('Feedback not found');
    res.json({ ok: true });
  })
);

// ============================================================== helpers
/** [[lng, lat], ...] -> LineString GeoJSON string (for path_geom). */
function buildLineStringGeojson(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  return JSON.stringify({ type: 'LineString', coordinates });
}

/** Replace a route's stop ordering in one transaction. */
async function replaceRouteStops(routeId, stops) {
  const list = Array.isArray(stops) ? stops : [];
  if (list.length === 0) return;
  // Normalise sequences to 1..N and dedupe stop ids.
  const seen = new Set();
  const rows = list
    .filter((s) => s && Number.isInteger(s.stopId) && !seen.has(s.stopId))
    .map((s) => {
      seen.add(s.stopId);
      return s;
    });

  await withTransaction(async (client) => {
    await client.query('DELETE FROM route_stops WHERE route_id = $1', [routeId]);
    for (let i = 0; i < rows.length; i += 1) {
      await client.query(
        'INSERT INTO route_stops (route_id, stop_id, sequence) VALUES ($1, $2, $3)',
        [routeId, rows[i].stopId, i + 1]
      );
    }
  });
}

export default router;

