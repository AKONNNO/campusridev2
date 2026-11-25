#!/usr/bin/env node
/**
 * KNUST Bus Tracker — apply schema.sql and seed.sql to the configured database.
 *
 *   npm run db:init            apply schema + seed (fresh database)
 *   npm run db:seed            seed only (schema already applied)
 *
 * Primary setup path is docker-compose (auto-runs the SQL files on first boot).
 * This script is a convenient equivalent when you run Postgres another way
 * and it works even if the `psql` CLI is not installed on the machine.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', 'src', 'db');
const seedOnly = process.argv.includes('--seed-only');

/**
 * Split a SQL script into individual statements.
 * Naively splitting on ";" would break the PL/pgSQL functions in schema.sql
 * (their bodies contain semicolons inside $$ ... $$ blocks), so we track
 * dollar-quoted regions and only split on semicolons outside them.
 */
function splitSql(sql) {
  const statements = [];
  let current = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (!inDollar && sql.startsWith('$$', i)) {
      inDollar = true;
      current += '$$';
      i += 1;
      continue;
    }
    if (inDollar && sql.startsWith('$$', i)) {
      inDollar = false;
      current += '$$';
      i += 1;
      continue;
    }
    if (!inDollar && ch === ';') {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();

  if (!seedOnly) {
    const schemaSql = await readFile(path.join(DB_DIR, 'schema.sql'), 'utf8');
    for (const stmt of splitSql(schemaSql)) {
      await client.query(stmt);
    }
    console.log('✔ schema applied');
  }

  const seedSql = await readFile(path.join(DB_DIR, 'seed.sql'), 'utf8');
  for (const stmt of splitSql(seedSql)) {
    await client.query(stmt);
  }
  console.log('✔ seed applied');
  console.log('Database ready.');
} catch (err) {
  console.error('Database init failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
