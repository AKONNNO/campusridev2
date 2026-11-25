import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/AppError.js';
import { validate } from '../middleware/validate.js';
import { queryOne } from '../config/db.js';
import { signToken } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  phone: z.string().trim().min(5).max(20),
  pin: z.string().min(4).max(64),
});

/**
 * POST /api/auth/login
 * Body: { phone, pin }
 * Students never authenticate — this is only for drivers and admins.
 * PINs are never stored or returned; only a JWT is issued.
 */
router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { phone, pin } = req.body;

    const user = await queryOne('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!user || !user.is_active) throw AppError.unauthorized('Invalid phone number or PIN');

    const ok = await bcrypt.compare(pin, user.pin_hash);
    if (!ok) throw AppError.unauthorized('Invalid phone number or PIN');

    let driverId = null;
    if (user.role === 'driver') {
      const driver = await queryOne('SELECT id FROM drivers WHERE user_id = $1', [user.id]);
      driverId = driver ? driver.id : null;
    }

    const token = signToken({ id: user.id, role: user.role, driverId });
    res.json({
      token,
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
      driverId,
    });
  })
);

export default router;
