import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCache, saveCache } from './cache.js';

const KEY = 'fav_stops';

/** Read favourite stops from localStorage (device-only, per spec point 11). */
function loadFavs() {
  const raw = loadCache(KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && f.stopId != null)
    .map((f) => ({ stopId: Number(f.stopId), name: f.name || '', addedAt: f.addedAt || Date.now() }));
}

/**
 * useFavStops — a student's favourite stops, persisted in localStorage.
 * Returns { favs, isFav, toggle, remove }.
 */
export function useFavStops() {
  const [favs, setFavs] = useState(loadFavs);

  useEffect(() => saveCache(KEY, favs), [favs]);

  const isFav = useCallback((stopId) => favs.some((f) => f.stopId === Number(stopId)), [favs]);

  const toggle = useCallback((stop) => {
    const id = Number(stop.id);
    setFavs((prev) => {
      if (prev.some((f) => f.stopId === id)) return prev.filter((f) => f.stopId !== id);
      return [...prev, { stopId: id, name: stop.name, addedAt: Date.now() }];
    });
  }, []);

  const remove = useCallback((stopId) => {
    const id = Number(stopId);
    setFavs((prev) => prev.filter((f) => f.stopId !== id));
  }, []);

  return useMemo(() => ({ favs, isFav, toggle, remove }), [favs, isFav, toggle, remove]);
}
