import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../../lib/api.js';
import { getSocket, connectSocket } from '../../lib/socket.js';
import { loadCache, saveCache, CACHE_BUSES } from './cache.js';

/**
 * Live bus state for the student map.
 *  • seeds from the REST endpoint (and the offline cache when offline)
 *  • applies Socket.IO bus:update / bus:offline / bus:ended to keep moving
 * Returns { buses, busList, connected } — `buses` is a Map-like object
 * keyed by busId so relation lookups are O(1).
 */
export function useLiveBuses(online) {
  const [buses, setBuses] = useState(() => {
    const cached = loadCache(CACHE_BUSES);
    return cached ? new Map(cached.map((b) => [b.busId, b])) : new Map();
  });
  const [connected, setConnected] = useState(false);
  const tick = useRef(0); // bump to force re-render after map mutations

  useEffect(() => {
    if (!online) return undefined;

    let alive = true;
    const socket = getSocket() || connectSocket();

    const upsert = (bus) => {
      if (!alive) return;
      tick.current += 1;
      setBuses((prev) => {
        const next = new Map(prev);
        const existing = next.get(bus.busId);
        next.set(bus.busId, existing ? { ...existing, ...bus } : bus);
        saveCache(CACHE_BUSES, [...next.values()]);
        return next;
      });
    };
    const remove = ({ busId }) => {
      if (!alive) return;
      tick.current += 1;
      setBuses((prev) => {
        const next = new Map(prev);
        next.delete(busId);
        saveCache(CACHE_BUSES, [...next.values()]);
        return next;
      });
    };
    const seed = async () => {
      try {
        const live = await get('/api/buses/live');
        if (!alive) return;
        tick.current += 1;
        const next = new Map();
        for (const b of live) next.set(b.busId, b);
        setBuses(next);
        saveCache(CACHE_BUSES, live);
      } catch {
        /* server unreachable — fall back to cache (handled by `online`) */
      }
    };

    const onConnect = () => {
      setConnected(true);
      seed();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('bus:update', upsert);
    socket.on('bus:offline', upsert);
    socket.on('bus:ended', remove);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();
    if (!socket.connected) {
      // Offline/refresh path: use whatever we cached last time.
      // eslint-disable-next-line no-console
      console.debug('Socket not connected; relying on cache + REST seed');
    }

    return () => {
      alive = false;
      socket.off('bus:update', upsert);
      socket.off('bus:offline', upsert);
      socket.off('bus:ended', remove);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [online]);

  const busList = useMemo(() => [...buses.values()], [buses]);
  return { buses, busList, connected, tick: tick.current };
}
