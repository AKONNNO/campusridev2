import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { AppError } from './lib/AppError.js';
import authRoutes from './routes/auth.routes.js';
import publicRoutes from './routes/public.routes.js';
import driverRoutes from './routes/driver.routes.js';
import adminRoutes from './routes/admin.routes.js';

/**
 * Express app factory. Middleware order matters:
 *   helmet → cors → logging → body parsing → rate limits → routes → 404 → errors
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Security headers.
  app.use(helmet());

  // CORS (explicit origins from env — never bare "*" with credentials).
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  // Request logging (dev only — noisy in production).
  if (!env.isProd) app.use(morgan('dev'));

  // Body parsing (small JS payloads → 100 kb cap is plenty).
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting: generous global limit, stricter on the login endpoint.
  const globalLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — slow down.' },
  });
  app.use('/api', globalLimiter);

  const authLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts — try again later.' },
  });
  app.use('/api/auth', authLimiter);

  // Health + route mounting.
  app.get('/api/health', (req, res) =>
    res.json({ ok: true, service: 'knust-bus-tracker', time: new Date().toISOString() })
  );
  app.use('/api/auth', authRoutes);
  app.use('/api', publicRoutes);
  app.use('/api/driver', driverRoutes);
  app.use('/api/admin', adminRoutes);

  // 404 for anything unmatched.
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.statusCode || 500;
    if (status === 500) console.error('[error]', err);
    const body = { error: status >= 500 ? 'Internal server error' : err.message };
    if (err.details) body.details = err.details;
    res.status(status).json(body);
  });

  return app;
}

// Re-export for convenience in tests / scripts.
export { AppError };
