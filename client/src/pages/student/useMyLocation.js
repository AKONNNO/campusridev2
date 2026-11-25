import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useMyLocation — the student's "Locate me" support.
 *
 * PRIVACY: the position is used on-device ONLY. It is never sent to any
 * server; nearest-stop math runs locally (lib/clientGeo.js) and the walking
 * line is drawn purely client-side. No student location is ever uploaded.
 *
 * locate() calls watchPosition so the marker follows the student as they
 * walk; stop()/clear() end tracking. Clear error states are exposed:
 *   'unsupported' | 'permission-denied' | 'unavailable' | 'timeout' | msg
 */
export function useMyLocation() {
  const watchId = useRef(null);
  const [state, setState] = useState({
    locating: false,
    myLoc: null, // { lat, lng, accuracy, ts }
    error: null,
  });

  const stop = useCallback(() => {
    if (watchId.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ locating: false, myLoc: null, error: 'unsupported' });
      return;
    }
    setState((s) => ({ ...s, locating: true, error: null }));
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          locating: false,
          myLoc: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy ?? 0),
            ts: pos.timestamp,
          },
          error: null,
        });
      },
      (err) => {
        stop();
        const code = err && err.code;
        setState((s) => ({
          ...s,
          locating: false,
          error:
            code === 1
              ? 'permission-denied'
              : code === 2
                ? 'unavailable'
                : code === 3
                  ? 'timeout'
                  : (err && err.message) || 'unknown',
        }));
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }, [stop]);

  const clear = useCallback(() => {
    stop();
    setState({ locating: false, myLoc: null, error: null });
  }, [stop]);

  // Stop tracking if the component unmounts.
  useEffect(() => stop, [stop]);

  return { ...state, locate, clear };
}
