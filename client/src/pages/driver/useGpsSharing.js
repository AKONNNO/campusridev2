import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../../lib/socket.js';

/**
 * useGpsSharing — drives the driver's phone GPS.
 *
 * Behaviours required by the spec:
 *  • watchPosition() sends a fix every 3-5 s (client-side throttle ~3 s)
 *  • poor-accuracy readings (accuracy > 50 m) are NOT sent (server filters too)
 *  • Wake Lock keeps the screen awake while sharing
 *  • network drops: the LATEST fix is queued and re-sent once the socket
 *    reconnects (we only keep the newest fix — positions are 6 small numbers,
 *    so discarding older queued fixes is the light and correct policy)
 *  • a live fix-age ticker + GPS error surfacing (e.g. permission denied)
 *
 * Returns { state, start, stop } where state includes:
 *   sharing, wakeLockHeld, lastFix (coords), fixAgeSeconds, dropped, error
 */
const MIN_INTERVAL_MS = 3000;
const MAX_ACCURACY_M = 50;

function toKmh(speedMps) {
  return speedMps != null && Number.isFinite(speedMps) ? Math.round(speedMps * 3.6) : 0;
}

export function useGpsSharing() {
  const watchId = useRef(null);
  const wakeLock = useRef(null);
  const lastSent = useRef(0);
  const pending = useRef(null);

  const [state, setState] = useState({
    sharing: false,
    wakeLockHeld: false,
    lastFix: null,
    fixAgeSeconds: 0,
    dropped: 0,
    error: null,
  });

  // Re-send the queued (latest) fix once the socket is back.
  const flushPending = useCallback(() => {
    const payload = pending.current;
    if (!payload) return;
    const socket = getSocket();
    if (socket && socket.connected) {
      pending.current = null;
      socket.emit('driver:location', payload, (ack) => {
        if (ack && !ack.ok && ack.error === 'no-active-trip') {
          setState((s) => ({ ...s, error: 'no-active-trip' }));
        }
      });
    }
  }, []);

  // Queue (keep only the newest fix) or send straight away.
  const sendOrQueue = useCallback((payload) => {
    const socket = getSocket();
    if (socket && socket.connected) {
      socket.emit('driver:location', payload, () => {});
    } else {
      pending.current = payload;
      setState((s) => ({ ...s, dropped: s.dropped + 1 }));
    }
  }, []);

  const onPosition = useCallback(
    (pos) => {
      const { latitude, longitude, accuracy, speed, heading } = pos.coords;
      const ts = pos.timestamp;

      setState((s) => ({
        ...s,
        lastFix: {
          lat: latitude,
          lng: longitude,
          accuracy: Math.round(accuracy ?? 0),
          speedKmh: toKmh(speed),
          heading: heading != null ? Math.round(heading) : 0,
          ts,
        },
        error: null,
      }));

      // Do not bother the server with fuzzy fixes.
      if (accuracy != null && accuracy > MAX_ACCURACY_M) return;

      const now = Date.now();
      if (now - lastSent.current < MIN_INTERVAL_MS) return; // ~3 s throttle
      lastSent.current = now;

      sendOrQueue({
        lat: latitude,
        lng: longitude,
        speed: toKmh(speed),
        heading: heading != null ? Math.round(heading) : 0,
        accuracy: Math.round(accuracy ?? 0),
        timestamp: ts,
      });
    },
    [sendOrQueue]
  );

  const onError = useCallback((err) => {
    const code = err?.code;
    const message =
      code === 1
        ? 'permission-denied'
        : code === 2
          ? 'GPS unavailable — check that location services are on'
          : `GPS error (${err?.message || 'unknown'})`;
    setState((s) => ({ ...s, error: message }));
  }, []);

  // Wake Lock + auto re-acquire when the tab becomes visible again.
  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock.current = lock;
      setState((s) => ({ ...s, wakeLockHeld: true }));
      lock.addEventListener('release', () => {
        wakeLock.current = null;
        setState((s) => ({ ...s, wakeLockHeld: false }));
      });
    } catch {
      /* wake lock not permitted — non-fatal */
    }
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'GPS is not supported on this device' }));
      return;
    }
    acquireWakeLock();
    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    });
    lastSent.current = 0;
    setState((s) => ({ ...s, sharing: true, error: null }));
  }, [acquireWakeLock, onPosition, onError]);

  const stop = useCallback(() => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (wakeLock.current) {
      wakeLock.current.release().catch(() => {});
      wakeLock.current = null;
    }
    pending.current = null;
    setState((s) => ({ ...s, sharing: false, wakeLockHeld: false }));
  }, []);

  // Socket reconnection → flush the queued latest fix.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socket.on('connect', flushPending);
    return () => socket.off('connect', flushPending);
  }, [flushPending]);

  // Keep the fix age ticking once a second.
  useEffect(() => {
    if (!state.sharing) return undefined;
    const timer = setInterval(() => {
      setState((s) => {
        if (!s.lastFix) return s;
        const age = Math.max(0, Math.round((Date.now() - s.lastFix.ts) / 1000));
        if (age === s.fixAgeSeconds) return s;
        return { ...s, fixAgeSeconds: age };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state.sharing]);

  // Re-acquire wake lock when the tab regains focus.
  useEffect(() => {
    if (!state.sharing) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !wakeLock.current) acquireWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [state.sharing, acquireWakeLock]);

  // Cleanup on unmount.
  useEffect(() => () => stop(), [stop]);

  return { state, start, stop };
}

