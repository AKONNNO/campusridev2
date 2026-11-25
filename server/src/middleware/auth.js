import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../lib/AppError.js';
import { queryOne } from '../config/db.js';

/**
 * Auth middleware + JWT helpers.
 *
 * Login (POST /api/auth/login) verifies the bcrypt PIN, then issues a JWT
 * carrying { sub: userId, role, driverId }. These middleware read that token.
 */
export function signToken({ id, role, driverId }) {
  return jwt.sign({ sub: id, role, driverId: driverId || null }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

/** Require a valid Bearer token, then attach req.user (fresh from the DB). */
export function protect(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(AppError.unauthorized());

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(AppError.unauthorized('Invalid or expired token'));
  }

  queryOne('SELECT id, name, phone, role, is_active FROM users WHERE id = $1', [payload.sub])
    .then((user) => {
      if (!user || !user.is_active) return next(AppError.unauthorized('Account disabled'));
      req.user = { id: user.id, name: user.name, phone: user.phone, role: user.role };
      if (payload.driverId) req.user.driverId = payload.driverId;
      return next();
    })
    .catch(next);
}

/** Restrict a protected route to specific roles ('admin', 'driver'). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(AppError.forbidden());
    }
    return next();
  };
}

/**
 * For driver-only routes: load req.driver = { driverId, assignedBusId }
 * from the drivers table (joined via the user).
 */
export function loadDriver(req, res, next) {
  queryOne(
    `SELECT d.id AS "driverId", d.assigned_bus_id AS "assignedBusId"
       FROM drivers d
       JOIN users u ON u.id = d.user_id
      WHERE u.id = $1`,
    [req.user.id]
  )
    .then((driver) => {
      if (!driver) return next(AppError.forbidden('Driver profile not found'));
      req.driver = { ...driver, driverId: driver.driverId ?? req.user.driverId };
      return next();
    })
    .catch(next);
}
