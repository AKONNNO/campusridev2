import { createServer } from 'node:http';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { createApp } from './app.js';
import { initSocket } from './socket/index.js';
import { routesCache, startRoutesRefreshTimer } from './services/routesCache.js';
import { liveBusStore } from './services/liveStore.js';

/**
 * KNUST Bus Tracker — server entry point.
 * Boot order:
 *   1. build the Express app
 *   2. attach Socket.IO to the same HTTP server
 *   3. load routes into memory (navigation models)
 *   4. start the offline sweeper + route refresh safety net
 *   5. listen
 */
async function main() {
  const app = createApp();
  const httpServer = createServer(app);
  initSocket(httpServer, app);

  // Warm the in-memory route models before accepting traffic.
  await routesCache.refresh();
  startRoutesRefreshTimer(60_000);

  liveBusStore.startOfflineSweeper();

  httpServer.listen(env.PORT, () => {
    console.log(`KNUST Bus Tracker API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async () => {
    console.log('Shutting down…');
    liveBusStore.stopOfflineSweeper();
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
