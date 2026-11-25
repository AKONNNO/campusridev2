import { useEffect, useMemo, useState } from 'react';
import { get } from '../../lib/api.js';
import { loadCache, CACHE_STOPS, CACHE_ROUTES, cachesForOffline } from './cache.js';

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
        /* unreachable — the cached copy is already on screen */
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
