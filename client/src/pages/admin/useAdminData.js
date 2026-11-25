import { useCallback, useEffect, useMemo, useState } from 'react';
import { get } from '../../lib/api.js';

/**
 * useAdminData — loads the admin CRUD collections once and exposes reload().
 *
 * Routes use the admin endpoints, so they come back with full geometry
 * (`path: [{lat,lng}]`) and ordered stops — exactly what the route editor and
 * the maps need. Announcements reuse the public active list (the backend
 * exposes create/remove but not a full admin list endpoint).
 *
 * Returns { buses, drivers, routes, stops, announcements, loading, error, reload }.
 */
export function useAdminData() {
  const [data, setData] = useState({
    buses: [],
    drivers: [],
    routes: [],
    stops: [],
    announcements: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [buses, drivers, routes, stops, announcements] = await Promise.all([
        get('/api/admin/buses'),
        get('/api/admin/drivers'),
        get('/api/admin/routes'),
        get('/api/admin/stops'),
        get('/api/announcements'),
      ]);
      setData({ buses, drivers, routes, stops, announcements });
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load admin data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return useMemo(
    () => ({ ...data, loading, error, reload: load }),
    [data, loading, error, load]
  );
}
