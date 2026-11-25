import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import { env } from '../config/env.js';
import { queryOne } from '../config/db.js';
import { liveBusStore } from '../services/liveStore.js';
import { verifyToken } from '../middleware/auth.js';

/**
 * Socket.IO layer — one shared connection for real-time traffic.
 *
 *  • Students  connect without a token and only receive:
 *        bus:update      (moving buses — small payloads)
 *        bus:offline     (a bus hasn't reported for 60 s)
 *        bus:ended       (a trip finished, remove the marker)
 *        announcement:new
 *  • Drivers  connect with a JWT in the auth payload and additionally send:
 *        driver:location {lat, lng, speed, heading, accuracy, timestamp}
 *      every 3-5 s; the server snap/smooths/plans and re-broadcasts bus:update.
 *
 * Payloads are deliberately tiny (6 numbers) for low-end phones / weak links.
 */

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed: z.number().min(0).max(300).optional(),
  heading: z.number().min(0).max(360).optional(),
  accuracy: z.number().min(0).max(2000).optional(),
  timestamp: z.number().optional(),
});

export function initSocket(httpServer, app) {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    pingTimeout: env.SOCKET_PING_TIMEOUT,
    pingInterval: env.SOCKET_PING_INTERVAL,
    transports: ['websocket', 'polling'], // polling fallback for weak links
    maxHttpBufferSize: 4096, // keep driver payloads small
  });

  // Socket authentication (optional — only tokens are verified).
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(); // public (student) socket
    try {
      const payload = verifyToken(token);
      const user = await queryOne('SELECT id, name, role, is_active FROM users WHERE id = $1', [payload.sub]);
      if (!user || !user.is_active) return next(new Error('unauthorized'));
      socket.data.user = { id: user.id, name: user.name, role: user.role };
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  // Bridge live-store events out to all clients.
  liveBusStore.on('bus:update', (bus) => io.emit('bus:update', bus));
  liveBusStore.on('bus:offline', (bus) => io.emit('bus:offline', bus));
  liveBusStore.on('bus:ended', (payload) => io.emit('bus:ended', payload));

  io.on('connection', async (socket) => {
    // Resolve the bus a driver owns so driver:location knows where to send it.
    if (socket.data.user?.role === 'driver') {
      try {
        const driver = await queryOne(
          'SELECT id, assigned_bus_id FROM drivers WHERE user_id = $1',
          [socket.data.user.id]
        );
        socket.data.driver = driver
          ? { driverId: driver.id, busId: driver.assigned_bus_id }
          : { driverId: null, busId: null };
      } catch {
        socket.data.driver = { driverId: null, busId: null };
      }
    }

    // Client → server: a GPS fix from a driver's phone.
    socket.on('driver:location', (data, ack) => {
      const parsed = locationSchema.safeParse(data || {});
      if (!parsed.success) {
        ack?.({ ok: false, error: 'invalid-payload' });
        return;
      }
      if (socket.data.user?.role !== 'driver') {
        ack?.({ ok: false, error: 'not-a-driver' });
        return;
      }
      const busId = socket.data.driver?.busId;
      if (!busId) {
        ack?.({ ok: false, error: 'no-assigned-bus' });
        return;
      }
      if (!liveBusStore.isLive(busId)) {
        ack?.({ ok: false, error: 'no-active-trip' });
        return;
      }
      const updated = liveBusStore.updateLocation(parsed.data, busId);
      ack?.({ ok: !!updated, busId });
    });

    socket.on('disconnect', () => {
      /* drivers get ack'd per packet; nothing to clean up here */
    });
  });

  // Expose io so HTTP handlers (e.g. announcements) can broadcast.
  app.set('io', io);
  return io;
}
