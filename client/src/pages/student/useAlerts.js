import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCache, saveCache } from './cache.js';
import { formatEta } from '../../lib/format.js';

const KEY = 'alerts';

function readAlerts() {
  return loadCache(KEY) || [];
}

/** Request browser notification permission (must be called from a user gesture). */
export function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  return Notification.permission === 'granted' || Notification.permission === 'default';
}

/**
 * Arrival alerts — "notify me when a bus is X minutes from this stop".
 *   • alerts persist in localStorage
 *   • every ~15 s the live bus upcoming-stop ETAs are checked against each alert
 *   • when a bus will arrive within the requested window it fires an in-app
 *     toast AND a browser notification (once per bus, so it doesn't spam)
 */
export function useAlerts({ busList }) {
  const [alerts, setAlerts] = useState(readAlerts);
  const [toasts, setToasts] = useState([]);
  const fired = useRef(new Set());

  // persist on change
  useEffect(() => saveCache(KEY, alerts), [alerts]);

  const addAlert = useCallback((stopId, stopName, minutes) => {
    const alert = {
      id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
      stopId,
      stopName,
      minutes,
      createdAt: Date.now(),
    };
    setAlerts((prev) => [...prev, alert]);
    return alert;
  }, []);

  const removeAlert = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fire = useCallback((alert, bus, etaSeconds) => {
    const key = `${alert.id}:${bus.busId}`;
    fired.current.add(key);
    const title = `🚌 ${bus.busNumber} → ${alert.stopName}`;
    const body = `Arriving in ${formatEta(etaSeconds)} (you asked to be notified within ${alert.minutes} min).`;
    setToasts((prev) => [{ id: `toast-${key}`, title, body, etaSeconds }, ...prev].slice(0, 3));
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        // data.url lets the service worker's notificationclick handler open
        // the right page when the user taps the notification.
        new Notification(title, { body, icon: '/favicon.svg', data: { url: '/' } });
      } catch {
        /* some browsers throw for Notification constructors without SW scope */
      }
    }
  }, []);

  const evalAlerts = useCallback(() => {
    if (alerts.length === 0) return;
    const upcomingByStop = new Map();
    for (const bus of busList) {
      for (const stop of bus.upcomingStops || []) {
        if (!upcomingByStop.has(stop.stopId)) upcomingByStop.set(stop.stopId, []);
        upcomingByStop.get(stop.stopId).push({ bus, etaSeconds: stop.etaSeconds });
      }
    }
    for (const alert of alerts) {
      const arrivals = upcomingByStop.get(alert.stopId) || [];
      const threshold = alert.minutes * 60;
      for (const { bus, etaSeconds } of arrivals) {
        const key = `${alert.id}:${bus.busId}`;
        if (!fired.current.has(key) && etaSeconds <= threshold) fire(alert, bus, etaSeconds);
      }
    }
  }, [alerts, busList, fire]);

  // poll while there are active alerts
  useEffect(() => {
    if (alerts.length === 0) return undefined;
    evalAlerts();
    const timer = setInterval(evalAlerts, 15_000);
    return () => clearInterval(timer);
  }, [alerts, evalAlerts]);

  const value = useMemo(
    () => ({ alerts, addAlert, removeAlert, toasts, dismissToast }),
    [alerts, addAlert, removeAlert, toasts, dismissToast]
  );
  return value;
}
