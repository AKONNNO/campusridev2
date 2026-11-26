import { useEffect, useMemo, useState } from 'react';
import { get } from '../../lib/api.js';
import { supabase } from '../../lib/supabase.js';
import { loadCache, CACHE_STOPS, CACHE_ROUTES, cachesForOffline } from './cache.js';

/**
 * Map a Supabase api_routes row into the same shape the backend /api/routes
 * returns: path as [{lat,lng}] vertices (converted from GeoJSON LineString).
 */
function toClientRoute(r) {
  const coords = r.path && r.path.type === 'LineString' ? r.path.coordinates : [];
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    colour: r.colour,
    isLoop: r.isLoop,
    isActive: r.isActive,
    totalDistanceM: Number(r.totalDistanceM) || 0,
    path: coords.map(([lng, lat]) => ({ lat, lng })),
    stops: [],
  };
}

/**
 * Read stops + routes straight from Supabase. Used as a fallback when the
 * Express backend is unreachable, so the campus map still renders.
 * Requires api_stops / api_routes views (granted to anon).
 */
async function fetchFromSupabase() {
  if (!supabase) throw new Error('Supabase not configured');
  const [stopsRes, routesRes] = await Promise.all([
    supabase.from('api_stops').select('*'),
    supabase.from('api_routes').select('*'),
  ]);
  if (stopsRes.error) throw stopsRes.error;
  if (routesRes.error) throw routesRes.error;
  return {
    stops: stopsRes.data.map((s) => ({ id: s.id, name: s.name, code: s.code, lat: s.lat, lng: s.lng })),
    routes: routesRes.data.map(toClientRoute),
  };
}

/**
 * useStopsAndRoutes — the cached campus data (stops + routes) that the whole
 * student app renders from.
 *
 * Offline support: the last-fetched stops/routes are read straight out of
 * localStorage and shown immediately; when the network is up they are then
 * refreshed from the server (and re-cached). This is how the map keeps
 * rendering stops and routes with no internet (spec point 13).
 *
 * Returns { stops, routes, loading }.
 */
export function useStopsAndRoutes(online) {
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState(() => loadCache(CACHE_STOPS) || []);
  const [routes, setRoutes] = useState(() => loadCache(CACHE_ROUTES) || []);

  useEffect(() => {
    if (!online) {
      setLoading(false);
      return undefined;
    }
    let alive = true;
    (async () => {
      try {
        const [s, r] = await Promise.all([get('/api/stops'), get('/api/routes')]);
        if (!alive) return;
        setStops(s);
        setRoutes(r);
        cachesForOffline(s, r);
      } catch {
        // Backend unreachable (not running / not deployed) — the static campus
        // map still renders straight from Supabase. Falls back to the cached
        // copy if Supabase is unavailable too.
        try {
          const next = await fetchFromSupabase();
          if (!alive) return;
          setStops(next.stops);
          setRoutes(next.routes);
          cachesForOffline(next.stops, next.routes);
        } catch {
          /* keep whatever cached copy is already on screen */
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [online]);

  return useMemo(() => ({ stops, routes, loading }), [stops, routes, loading]);
}
