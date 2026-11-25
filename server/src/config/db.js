import pg from 'pg';
import { env } from './env.js';

/**
 * Shared PostgreSQL pool.
 * A single pool is created at boot and reused by every query in the app.
 * PostGIS types (geometry) come back as GeoJSON-ish WKB unless we ask for
 * GeoJSON text, so the query layer always uses ST_AsGeoJSON / ST_X / ST_Y.
 */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/** Convenience wrapper: runs a query and returns only the rows. */
export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

/** Convenience wrapper for a query that must return exactly one row. */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  if (rows.length === 0) return null;
  return rows[0];
}

/** Convenience wrapper for INSERT/UPDATE/DELETE that returns affected count. */
export async function execute(text, params = []) {
  const result = await pool.query(text, params);
  return result.rowCount ?? 0;
}

/** Run several statements inside a single transaction (all-or-nothing). */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
