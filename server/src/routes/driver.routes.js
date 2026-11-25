import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/AppError.js';
import { validate } from '../middleware/validate.js';
import { protect, requireRole, loadDriver } from '../middleware/auth.js';
import { queryOne } from '../config/db.js';
import { routesCache } from '../services/routesCache.js';
import { liveBusStore } from '../services/liveStore.js';

/**
 * Driver routes — authenticated (JWT), driver role only. The driver logs in
 * with phone + PIN, and everything here resolves against the bus that the
 * admin assigned to them (drivers.assigned_bus_id).
 */
const router = Router();

router.use(protect, requireRole('driver'), loadDriver);

// ---------------------------------------------------------------- /me
/** GET /api/driver/me — driver context: assigned bus, route, active trip. */
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { driverId, assignedBusId } = req.driver;

    const bus = assignedBusId
      ? await queryOne(
          `SELECT b.id, b.bus_number, b.model, b.capacity, b.status, b.route_id AS "routeId",
                  r.name AS "routeName", r.colour AS "routeColour"
             FROM buses b
             LEFT JOIN routes r ON r.id = b.route_id
            WHERE b.id = $1`,
          [assignedBusId]
        )
      : null;

    const activeTrip = assignedBusId
      ? await queryOne(
          `SELECT id, route_id AS "routeId", started_at AS "startedAt"
             FROM trips
            WHERE bus_id = $1 AND status = 'active'
            ORDER BY started_at DESC
            LIMIT 1`,
          [assignedBusId]
        )
      : null;

    const liveBus = assignedBusId ? liveBusStore.getBus(assignedBusId) : null;

    res.json({
      driver: { id: driverId, name: req.user.name, phone: req.user.phone },
      bus,
      activeTrip,
      isSharing: liveBus ? liveBus.status : null,
      availableRoutes: routesCache.all.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        colour: m.colour,
        isLoop: m.isLoop,
        stops: m.stops.map((s) => ({ id: s.id, name: s.name })),
      })),
    });
  })
);

// ----------------------------------------------------------- /trip/start
const startTripSchema = z.object({
  busId: z.coerce.number().int().positive().optional(),
  routeId: z.coerce.number().int().positive().optional(),
});

/** POST /api/driver/trip/start — begin a trip on the assigned (or chosen) bus. */
router.post(
  '/trip/start',
  validate(startTripSchema),
  asyncHandler(async (req, res) => {
    const busId = req.body.busId || req.driver.assignedBusId;
    if (!busId) throw AppError.badRequest('No bus assigned; ask the admin to assign one');

    const bus = await queryOne('SELECT id, route_id FROM buses WHERE id = $1', [busId]);
    if (!bus) throw AppError.notFound('Bus not found');
    if (req.driver.assignedBusId && Number(busId) !== Number(req.driver.assignedBusId)) {
      throw AppError.forbidden('You can only start a trip on your assigned bus');
    }

    const started = await liveBusStore.startTrip({
      driverId: req.driver.driverId,
      driverName: req.user.name,
      busId: Number(busId),
      routeId: req.body.routeId,
    });

    res.status(201).json({
      ok: true,
      trip: { id: started.tripId, busId: started.busId, routeId: started.routeId },
      message: 'Trip started — GPS sharing is active',
    });
  })
);

// ------------------------------------------------------------- /trip/end
/** POST /api/driver/trip/end — end the active trip and stop sharing GPS. */
router.post(
  '/trip/end',
  asyncHandler(async (req, res) => {
    const busId = Number(req.driver.assignedBusId);
    if (!busId) throw AppError.badRequest('No assigned bus');

    const result = await liveBusStore.endTrip(busId);
    res.json({
      ok: true,
      message: 'Trip ended — GPS sharing stopped',
      ...result,
    });
  })
);

// ------------------------------------------------------------ /status
const statusSchema = z.object({
  status: z.enum(['on_trip', 'break', 'breakdown', 'full']),
  busId: z.coerce.number().int().positive().optional(),
});

/** POST /api/driver/status — set bus status (On route / Break / Breakdown / Full). */
router.post(
  '/status',
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const busId = req.body.busId || req.driver.assignedBusId;
    if (!busId) throw AppError.badRequest('No assigned bus');

    const bus = liveBusStore.updateStatus(busId, req.body.status);
    res.json({ ok: true, bus: liveBusStore.publicBus(bus), message: `Status set to ${req.body.status}` });
  })
);

export default router;
