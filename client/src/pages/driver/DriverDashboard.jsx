import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post } from '../../lib/api.js';
import { getSocket, connectSocket } from '../../lib/socket.js';
import { useAuth } from '../../lib/useAuth.jsx';
import { useGpsSharing } from './useGpsSharing.js';

/** Driver-selectable statuses with badge styling. */
const STATUS_OPTIONS = [
  { value: 'on_trip', label: 'On route', color: 'bg-emerald-500 text-white' },
  { value: 'break', label: 'Break', color: 'bg-amber-500 text-night-900' },
  { value: 'breakdown', label: 'Breakdown', color: 'bg-red-600 text-white' },
  { value: 'full', label: 'Full', color: 'bg-violet-500 text-white' },
];

const KIND_BADGES = {
  delay: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  breakdown: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  schedule: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
};

/**
 * Driver dashboard — assigned bus, route picker, Start/End trip, status
 * buttons, live GPS-sharing indicators and admin announcements.
 */
export default function DriverDashboard() {
  const { user, token, logout } = useAuth();
  const gps = useGpsSharing();

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null); // { driver, bus, activeTrip, availableRoutes }
  const [routeId, setRouteId] = useState(null);
  const [tripActive, setTripActive] = useState(false);
  const [status, setStatus] = useState('on_trip');
  const [announcements, setAnnouncements] = useState([]);
  const [socketOnline, setSocketOnline] = useState(false);
  const [busyStart, setBusyStart] = useState(false);
  const [busyEnd, setBusyEnd] = useState(false);
  const [notice, setNotice] = useState(null); // transient error/success toast

  // ---- sync socket connection with the logged-in driver ----
  useEffect(() => {
    if (!user) return undefined;
    // Reconnect with the stored token after a hard page reload; the login
    // screen has already connected with a token when signing in fresh.
    const socket = getSocket() || connectSocket(token);
    const onConnect = () => setSocketOnline(true);
    const onDisconnect = () => setSocketOnline(false);
    const onAnnouncement = (a) => setAnnouncements((prev) => [a, ...prev]);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('announcement:new', onAnnouncement);
    setSocketOnline(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('announcement:new', onAnnouncement);
    };
  }, [user]);

  // ---- load driver context + announcements once ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [context, anns] = await Promise.all([get('/api/driver/me'), get('/api/announcements')]);
        if (!alive) return;
        setMe(context);
        setRouteId(context.bus?.routeId ?? null);
        // Auto-resume an already-open trip (e.g. after the driver reloads).
        if (context.activeTrip) {
          setTripActive(true);
          gps.start();
        }
        setAnnouncements(anns);
      } catch (err) {
        if (alive) setNotice(err.message || 'Could not load your account.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- trip lifecycle ----
  const handleStartTrip = useCallback(async () => {
    setBusyStart(true);
    setNotice(null);
    try {
      await post('/api/driver/trip/start', { routeId: routeId || undefined });
      setTripActive(true);
      setStatus('on_trip');
      gps.start();
      setNotice({ kind: 'ok', text: 'Trip started — GPS sharing is ON' });
    } catch (err) {
      setNotice({ kind: 'err', text: err.message || 'Could not start trip' });
    } finally {
      setBusyStart(false);
    }
  }, [routeId, gps]);

  const handleEndTrip = useCallback(async () => {
    setBusyEnd(true);
    setNotice(null);
    try {
      await post('/api/driver/trip/end');
      setTripActive(false);
      gps.stop();
      setNotice({ kind: 'ok', text: 'Trip ended — GPS sharing stopped' });
    } catch (err) {
      setNotice({ kind: 'err', text: err.message || 'Could not end trip' });
    } finally {
      setBusyEnd(false);
    }
  }, [gps]);

  const handleStatus = useCallback(async (value) => {
    setStatus(value);
    try {
      await post('/api/driver/status', { status: value });
    } catch {
      /* keep local selection even if the push lags on a weak connection */
    }
  }, []);

  const routeOptions = useMemo(() => me?.availableRoutes ?? [], [me]);
  const bus = me?.bus || null;
  const activeRoute = routeOptions.find((r) => r.id === routeId) || null;

  // ------------------------------------------------------------------ view
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading your bus…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-night pb-10">
      {/* header */}
      <header className="sticky top-0 z-20 bg-night text-white shadow-md">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="font-bold truncate">🚌 KNUST Bus Tracker</h1>
            <p className="text-xs text-slate-300 truncate">
              {bus ? `${bus.bus_number} · ${bus.model}` : 'Driver app'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`pill ${socketOnline ? 'bg-emerald-500 text-white' : 'bg-slate-600 text-slate-200'}`}>
              {socketOnline ? '● Live' : '○ Offline'}
            </span>
            <button onClick={logout} className="btn-secondary !px-3 !py-1.5 !min-h-0 text-sm" title="Sign out">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4 space-y-4">
        {/* GPS sharing banner */}
        <div
          className={`rounded-2xl p-4 flex items-center justify-between gap-3 ${
            gps.state.sharing
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-300 dark:bg-night-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${gps.state.sharing ? 'bg-white animate-pulse' : 'bg-slate-400'}`} />
              <span className="font-bold">{gps.state.sharing ? 'GPS sharing is ON' : 'GPS sharing is OFF'}</span>
            </div>
            <p className="text-xs mt-1 opacity-90">
              {gps.state.sharing
                ? 'Your bus position updates every few seconds.'
                : 'Start a trip to begin sharing location.'}
            </p>
          </div>
          {gps.state.sharing && gps.state.lastFix && (
            <div className="text-right text-xs font-mono leading-tight opacity-90">
              <div>{gps.state.lastFix.speedKmh} km/h</div>
              <div>±{gps.state.lastFix.accuracy} m</div>
              <div>{gps.state.fixAgeSeconds}s ago</div>
            </div>
          )}
        </div>

        {gps.state.wakeLockHeld && (
          <div className="pill bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
            ⚡ Screen wake lock active
          </div>
        )}

        {notice && (
          <button
            className={`w-full text-left rounded-xl px-4 py-3 text-sm ${
              notice.kind === 'ok'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30'
                : 'bg-red-50 text-red-700 dark:bg-red-900/30'
            }`}
            onClick={() => setNotice(null)}
          >
            {notice.text}
          </button>
        )}

        {gps.state.error && (
          <div className="rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
            ⚠️ {gps.state.error}
          </div>
        )}

        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-black tracking-tight">{bus?.bus_number}</div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {bus?.model} · capacity {bus?.capacity}
              </p>
            </div>
            <span className="pill bg-slate-100 dark:bg-night-700 text-slate-600 dark:text-slate-300">
              {user?.name?.split(' ')[0]}
            </span>
          </div>

          <div>
            <label className="label" htmlFor="route">Route</label>
            <select
              id="route"
              className="input"
              value={routeId ?? ''}
              onChange={(e) => setRouteId(Number(e.target.value))}
              disabled={tripActive}
            >
              <option value="" disabled>Select route…</option>
              {routeOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
              ))}
            </select>
          </div>
        </section>

        {/* trip controls */}
        <section className="card p-4 space-y-3">
          {!tripActive ? (
            <>
              <button
                className="btn w-full bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={handleStartTrip}
                disabled={busyStart || !routeId}
              >
                {busyStart ? 'Starting…' : '▶  Start trip'}
              </button>
              {!routeId && <p className="text-xs text-slate-400">Pick a route above to start.</p>}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Running on {activeRoute?.name} — set your status:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`rounded-xl px-3 py-3 text-sm font-bold ${opt.color} ${
                      status === opt.value ? 'ring-2 ring-slate-900 dark:ring-white' : ''
                    }`}
                    onClick={() => handleStatus(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button className="btn-danger w-full" onClick={handleEndTrip} disabled={busyEnd}>
                {busyEnd ? 'Ending…' : '■  End trip'}
              </button>
              <p className="text-[11px] text-slate-400 text-center">
                {gps.state.dropped > 0 ? `${gps.state.dropped} fix(es) queued offline` : 'Network: up to date'}
              </p>
            </>
          )}
        </section>

        {/* announcements */}
        {announcements.length > 0 && (
          <section className="card p-4">
            <h2 className="font-bold mb-2 text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Announcements
            </h2>
            <ul className="space-y-2">
              {announcements.map((a) => (
                <li key={a.id} className="rounded-xl border border-slate-200 dark:border-night-700 p-3">
                  <span className={`pill ${KIND_BADGES[a.kind] || KIND_BADGES.info} uppercase`}>{a.kind}</span>
                  <p className="font-semibold mt-1.5 text-sm">{a.title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{a.message}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* live fix readout */}
        <section className="card p-4 grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-xs text-slate-400 uppercase">Lat</p>
            <p className="font-mono">{gps.state.lastFix ? gps.state.lastFix.lat.toFixed(5) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase">Lng</p>
            <p className="font-mono">{gps.state.lastFix ? gps.state.lastFix.lng.toFixed(5) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase">Heading</p>
            <p className="font-mono">{gps.state.lastFix ? `${gps.state.lastFix.heading}°` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase">Fix age</p>
            <p className="font-mono">{gps.state.lastFix ? `${gps.state.fixAgeSeconds}s` : '—'}</p>
          </div>
        </section>
      </main>
    </div>
  );
}

