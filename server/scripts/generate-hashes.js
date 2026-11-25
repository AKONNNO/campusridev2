#!/usr/bin/env node
/**
 * KNUST Bus Tracker - dev helper
 *  Usage: node scripts/generate-hashes.js <pin-or-password>
 *  Prints a bcrypt hash for the given value (uses cost from .env / default 10).
 *
 * This is only needed when you want to bake a new credential directly into
 * seed.sql. The normal flow (admin creates a driver) hashes at runtime.
 */
import 'dotenv/config.js';
import bcrypt from 'bcryptjs';

const raw = process.argv[2];
if (!raw) {
  console.error('Usage: node scripts/generate-hashes.js <pin>');
  process.exit(1);
}

const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
const hash = await bcrypt.hash(raw, rounds);
console.log(hash);
