import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Server-side Supabase admin client.
 *
 * Uses the service-role key, which bypasses Row Level Security and is intended
 * for backend use only — never expose it to the browser. `supabaseAdmin` is
 * `null` until the env vars are set, so the existing PostgreSQL/PostGIS + JWT
 * stack keeps working untouched.
 */
export const isSupabaseConfigured = Boolean(
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
);

/** Admin Supabase client with full access (or null when not configured). */
export const supabaseAdmin = isSupabaseConfigured
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false, // no browser URL hash to parse on the server
      },
    })
  : null;
