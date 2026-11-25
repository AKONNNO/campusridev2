import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDarkMode } from '../../hooks/useDarkMode.js';
import { useInstallPrompt } from '../../hooks/useInstallPrompt.js';
import { nearestStops } from '../../lib/clientGeo.js';
import MapView from './MapView.jsx';
import Panels from './Panels.jsx';
import { useLiveBuses } from './useLiveBuses.js';
import { useAlerts, requestNotificationPermission } from './useAlerts.js';
import { useMyLocation } from './useMyLocation.js';
import { useStopsAndRoutes } from './useStopsAndRoutes.js';
import { useAnnouncements } from './useAnnouncements.js';
import { useFavStops } from './useFavStops.js';

/** Announcement kind → badge styling. */
const KIND_BADGES = {
  delay: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  breakdown: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  schedule: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
};

/**
 * StudentPage — the main student app. No login required.
 *
 * Composes: the live map (MapView), the bottom sheet of tools (Panels),
 * a header overlay ("Locate me", dark-mode toggle, live/offline status),
 * the announcements banner, GPS-error / offline clear states and the
 * arrival-alert toasts.
 *
 * PRIVACY: the student's location (useMyLocation) is used on-device only —
 * it is never sent to any server. Nearest-stop math is done locally
 * (lib/clientGeo.js, spec point: Haversine in the frontend for speed) and
 * only bus/driver data ever travels over the network.
 */
export default function StudentPage() {
  const [dark, setDark] = useDarkMode();
  const [online, setOnline] = useState(() => navigator.onLine);

  const { stops, routes } = useStopsAndRoutes(online);
  const { busList, connected } = useLiveBuses(online);
  const { announcements, dismiss } = useAnnouncements(online);
  const fav = useFavStops();
  const geo = useMyLocation();
  const alerts = useAlerts({ busList });
  const install = useInstallPrompt();

  const [tab, setTab] = useState('live');
  const [open, setOpen] = useState(true);
  const [selBus, setSelBus] = useState(null);
  const [selStop, setSelStop] = useState(null);
  const [hiddenRouteIds, setHiddenRouteIds] = useState(() => new Set());
  // "Install the app" prompt: shown once (until the user dismisses it) when the
  // browser offers a beforeinstallprompt; hidden forever after dismissal.
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return localStorage.getItem('knust_install_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const mapRef = useRef(null);

  // Track the browser's online/offline state for the clear "no internet"
  // state (spec point 13) — cached stops/routes are shown when offline.
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Nearest stops from the device position (instant, client-side Haversine).
  const nearestList = useMemo(
    () => (geo.myLoc ? nearestStops(stops, geo.myLoc.lat, geo.myLoc.lng, 4) : []),
    [geo.myLoc, stops]
  );
  const nearestStop = nearestList[0] || null;

  const setMap = useCallback((m) => {
    mapRef.current = m;
  }, []);

  const selectBus = useCallback((bus) => {
    setSelBus(bus);
    setTab('live');
    setOpen(true);
    if (mapRef.current && bus.lat != null) {
      mapRef.current.flyTo([bus.lat, bus.lng], Math.max(mapRef.current.getZoom(), 16), { duration: 0.8 });
    }
  }, []);

  const selectStop = useCallback((stop) => {
    setSelStop(stop);
    setOpen(true);
    if (mapRef.current) {
      mapRef.current.flyTo([stop.lat, stop.lng], Math.max(mapRef.current.getZoom(), 17), { duration: 0.8 });
    }
  }, []);

  const clearSelStop = useCallback(() => setSelStop(null), []);

  const toggleRoute = useCallback((id) => {
    setHiddenRouteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Called from a user gesture: ask for notification permission, then arm.
  const addAlertStop = useCallback(
    (stop, minutes) => {
      if (!stop || !minutes) return;
      requestNotificationPermission();
      alerts.addAlert(stop.id, stop.name, minutes);
    },
    [alerts]
  );

  const removeAlert = useCallback((id) => alerts.removeAlert(id), [alerts]);

  const showInstall = install.canInstall && !installDismissed;
  const dismissInstall = useCallback(() => {
    setInstallDismissed(true);
    try {
      localStorage.setItem('knust_install_dismissed', '1');
    } catch {
      /* private mode */
    }
  }, []);

  // "Locate me" toggles tracking on/off.
  const handleLocate = useCallback(() => {
    if (geo.myLoc) geo.clear();
    else geo.locate();
  }, [geo]);

  const geoMessage = useMemo(() => {
    switch (geo.error) {
      case 'permission-denied':
        return 'Location permission denied. Enable location access to find your nearest stop.';
      case 'unavailable':
        return 'GPS unavailable — check that location services are on.';
      case 'unsupported':
        return 'This device or browser does not support geolocation.';
      case 'timeout':
        return 'Timed out getting your position. Try again.';
      case null:
        return null;
      default:
        return geo.error;
    }
  }, [geo.error]);

  return (
    <div className="relative h-full w-full bg-slate-100 dark:bg-night overflow-hidden">
      {/* full-screen live map */}
      <MapView
        routes={routes}
        hiddenRouteIds={hiddenRouteIds}
        stops={stops}
        busList={busList}
        selectedBusId={selBus?.busId}
        myLoc={geo.myLoc}
        nearestStop={nearestStop}
        onBusClick={selectBus}
        onStopClick={selectStop}
        onToggleRoute={toggleRoute}
        onMap={setMap}
      />

      {/* header overlay */}
      <header className="absolute top-0 inset-x-0 z-[1001] bg-gradient-to-b from-slate-900/85 via-slate-900/40 to-transparent pb-10 text-white pointer-events-none">
        <div className="max-w-md mx-auto px-3 pt-3 flex items-center gap-2 pointer-events-auto">
          <div className="flex-1 min-w-0">
            <h1 className="font-black text-lg leading-tight truncate">🚌 KNUST Bus Tracker</h1>
            <p className="text-[11px] text-slate-200 truncate">
              <span
                className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${
                  connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                }`}
              />
              {connected ? 'Live updates' : online ? 'Connecting…' : 'Offline mode'}
              {geo.myLoc ? ' · 📍 you located' : ''}
            </p>
          </div>
          <button
            onClick={handleLocate}
            disabled={geo.locating}
            className="btn-primary !py-2 !px-3 !min-h-0 text-sm"
            title="Find the nearest stop and draw the walk on the map"
          >
            {geo.locating ? 'Locating…' : geo.myLoc ? '📍 Relocate' : '📍 Locate me'}
          </button>
          <button
            onClick={() => setDark(!dark)}
            className="btn-secondary !py-2 !px-3 !min-h-0 text-sm"
            title="Toggle dark mode"
            aria-label="Toggle dark mode"
          >
            {dark ? '☀️' : '🌙'}
          </button>
          <Link
            to="/driver"
            className="btn-secondary !py-2 !px-3 !min-h-0 text-sm hidden sm:inline-flex"
            title="Driver app"
          >
            Driver
          </Link>
        </div>
      </header>

      {/* notices stack: install prompt, GPS error, announcements banner, alert toasts */}
      {(showInstall || geoMessage || announcements.length > 0 || alerts.toasts.length > 0) && (
        <div className="absolute top-[64px] inset-x-0 z-[1002] px-3 space-y-2 pointer-events-none max-w-md mx-auto">
          {showInstall && (
            <div className="pointer-events-auto card !rounded-xl p-3 relative shadow-lg">
              <div className="flex items-center gap-3 pr-7">
                <span className="text-2xl shrink-0">📲</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm leading-tight">Install the app</p>
                  <p className="text-xs text-slate-500 dark:text-slate-300">
                    One-tap access from your home screen + offline maps.
                  </p>
                </div>
                <button
                  onClick={install.install}
                  disabled={install.installed}
                  className="btn-primary !px-3 !py-2 !min-h-0 text-sm shrink-0"
                >
                  Install
                </button>
              </div>
              <button
                onClick={dismissInstall}
                className="absolute top-1.5 right-1.5 btn-secondary !px-1.5 !py-0.5 !min-h-0 text-xs"
                aria-label="Dismiss install prompt"
                title="Don't show this again"
              >
                ✕
              </button>
            </div>
          )}

          {geoMessage && (
            <div className="pointer-events-auto rounded-xl px-3 py-2.5 text-sm bg-amber-50 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 shadow-lg border border-amber-200 dark:border-amber-800">
              ⚠️ {geoMessage}{' '}
              <button
                className="underline font-semibold"
                onClick={() => {
                  geo.clear();
                  geo.locate();
                }}
              >
                Retry
              </button>
            </div>
          )}

          {announcements.slice(0, 3).map((a) => (
            <div key={a.id} className="pointer-events-auto card !rounded-xl p-3 flex gap-2 shadow-lg">
              <span className={`pill self-start uppercase ${KIND_BADGES[a.kind] || KIND_BADGES.info}`}>
                {a.kind}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm leading-tight">{a.title}</p>
                {a.message && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">
                    {a.message}
                  </p>
                )}
              </div>
              <button
                className="btn-secondary !px-2 !py-0.5 !min-h-0 text-xs shrink-0"
                onClick={() => dismiss(a.id)}
                aria-label="Dismiss announcement"
              >
                ✕
              </button>
            </div>
          ))}

          {alerts.toasts.map((t) => (
            <button
              key={t.id}
              onClick={() => alerts.dismissToast(t.id)}
              className="pointer-events-auto w-full text-left rounded-xl px-3 py-2.5 bg-emerald-600 text-white shadow-lg"
            >
              <span className="font-bold">{t.title}</span>
              <span className="block text-xs text-emerald-100 mt-0.5">{t.body}</span>
            </button>
          ))}
        </div>
      )}

      {/* first-load / empty-data clear state */}
      {stops.length === 0 && !online && (
        <div className="absolute inset-0 z-[1003] flex items-center justify-center p-6 pointer-events-none">
          <div className="card p-6 max-w-sm text-center pointer-events-auto">
            <div className="text-3xl mb-2">📡</div>
            <p className="font-semibold">You’re offline</p>
            <p className="text-sm text-slate-500 mt-1">
              No cached stops or routes on this device yet. Reconnect once to
              download the campus map, and it will be available offline.
            </p>
          </div>
        </div>
      )}

      {/* bottom sheet of tools */}
      <Panels
        tab={tab}
        setTab={setTab}
        open={open}
        setOpen={setOpen}
        busList={busList}
        myLoc={geo.myLoc}
        stops={stops}
        routes={routes}
        selBus={selBus}
        selStop={selStop}
        nearestList={nearestList}
        favs={fav.favs}
        isFav={fav.isFav}
        onToggleFav={fav.toggle}
        onSelectBus={selectBus}
        onSelectStop={selectStop}
        onClearSelStop={clearSelStop}
        onAddAlertStop={addAlertStop}
        onRemoveAlert={removeAlert}
        alerts={alerts.alerts}
        online={online}
      />
    </div>
  );
}

