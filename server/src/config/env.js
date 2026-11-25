import 'dotenv/config';

/**
 * Centralised, validated environment configuration.
 * All tunables used by the server live here (not spread through the codebase).
 */
export const env = {
  /** HTTP port for Express (Socket.IO shares the same server). */
  PORT: Number.parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  /** PostgreSQL + PostGIS connection string. */
  DATABASE_URL:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/knust_bus_tracker',

  /** JWT + bcrypt auth. */
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  BCRYPT_ROUNDS: Number.parseInt(process.env.BCRYPT_ROUNDS || '10', 10),

  /** Comma-separated list of allowed CORS origins (Vite dev server). */
  CLIENT_ORIGIN: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Rate limiting. */
  RATE_LIMIT_WINDOW_MS: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  RATE_LIMIT_MAX: Number.parseInt(process.env.RATE_LIMIT_MAX || '120', 10),

  /** Socket.IO transport tuning for weak connections. */
  SOCKET_PING_TIMEOUT: Number.parseInt(process.env.SOCKET_PING_TIMEOUT || '10000', 10),
  SOCKET_PING_INTERVAL: Number.parseInt(process.env.SOCKET_PING_INTERVAL || '8000', 10),

  /** How often the offline sweeper runs. */
  OFFLINE_SWEEP_MS: 10000,
  /** A bus with no update for this long is considered offline. */
  OFFLINE_AFTER_MS: 60000,

  /** ETA / navigation tunables (see services/navigation.js for details). */
  MIN_SPEED_KMH: 8,
  AVG_DWELL_SECONDS: 20,
  SMOOTH_WINDOW: 5,

  /** GPS filtering. */
  MAX_ACCURACY_M: 50,
  MAX_JUMP_M: 150, // max metres between two consecutive updates
  MAX_SPEED_KMH: 90, // cap to reject unrealistic readings
};
