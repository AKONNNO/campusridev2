import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client (browser).
 *
 * Creates a single client from the Vite public env vars. Returns `null` when
 * Supabase isn't configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY empty),
 * so the rest of the app keeps working without it.
 *
 * Set in client/.env (see client/.env.example):
 *   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon-key>
 */
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** Whether the required env vars are present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/** Ready-to-use browser Supabase client (or null when not configured). */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
