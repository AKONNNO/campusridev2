import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../../../lib/api.js';
import AdminMap from '../AdminMap.jsx';

/**
 * TripsTab — trip history with a map replay. Each trip's ordered GPS points
 * come from /api/admin/trips/:id/locations and play back as a moving marker
 * over the recorded path (one point every 300 ms) with play/pause + progress.
 */

/** Player + progress for a single trip's recorded points. */
function TripPlayer({ trip }) {
  const [pts, setPts] = useState([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    setPlaying(false);
    get(`/api/admin/trips/${trip.id}/locations`)
      .then((d) => {
        if (!alive) return;
        setPts(d.points || []);
        setIdx(0);
      })
      .catch((e) => alive && setErr(e.message || 'Could not load trip points.'));
    return () => {
      alive = false;
      clearInterval(timer.current);
    };
  }, [trip.id]);

  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setInterval(
      () => setIdx((i) => Math.min(i + 1, Math.max(pts.length - 1, 0))),
      300
    );
    return () => clearInterval(timer.current);
  }, [playing, pts.length]);

  useEffect(() => {
    if (playing && pts.length > 0 && idx >= pts.length - 1) setPlaying(false);
  }, [idx, playing, pts.length]);

  const pos = pts[idx] || null;

  const pseudoRoute = useMemo(
    () => [
      {
        id: `t-${trip.id}`,
        name: trip.routeName || 'Trip',
        colour: trip.routeColour || '#0ea5e9',
        path: pts.map((p) => ({ lat: p.lat, lng: p.lng })),
      },
    ],
    [pts, trip]
  );

  const pseudoBus = pos
    ? [
        {
          busId: `trip-${trip.id}`,
          busNumber: trip.busNumber,
          status: 'on_trip',
          lat: pos.lat,
          lng: pos.lng,
          heading: pos.heading || 0,
          speedKmh: Math.round(pos.speed || 0),
          route: { colour: trip.routeColour || '#0ea5e9' },
        },
      ]
    : [];

  if (err) return <p className="text-sm text-red-600 dark:text-red-400">{err}</p>;
  if (pts.length === 0)
    return <p className="text-sm text-slate-400">Loading trip points…</p>;

  const progress = pts.length > 1 ? Math.round((idx / (pts.length - 1)) * 100) : 0;

  return (
    <div className="space-y-3">
      <AdminMap routes={pseudoRoute} stops={[]} busList={pseudoBus} mode="view" />
      <div className="flex items-center gap-3">
        <button className="btn-primary !py-2 !px-4 !min-h-0 text-sm" onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-night-700 overflow-hidden">
          <div className="h-full bg-brand-500" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs text-slate-500">{idx + 1}/{pts.length}</span>
      </div>
      {pos && (
        <p className="text-xs text-slate-500 font-mono">
          {pos.lat.toFixed(6)}, {pos.lng.toFixed(6)} · {Math.round(pos.speed || 0)} km/h ·{' '}
          {pos.t ? new Date(pos.t).toLocaleTimeString() : ''}
        </p>
      )}
    </div>
  );
}

export default function TripsTab() {
  const [trips, setTrips] = useState(null);
  const [replay, setReplay] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setTrips(null);
    get('/api/admin/trips')
      .then((rows) => alive && setTrips(rows))
      .catch((e) => alive && setError(e.message || 'Could not load trips.'));
    return () => {
      alive = false;
    };
  }, []);

  const badge = (s) =>
    s === 'completed'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40'
      : s === 'cancelled'
        ? 'bg-red-100 text-red-700 dark:bg-red-900/40'
        : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Trip history</h2>
        {replay && (
          <button className="btn-secondary !py-1 !px-2 !min-h-0 text-xs" onClick={() => setReplay(null)}>
            Close replay
          </button>
        )}
      </div>

      {replay && (
        <div className="card p-3">
          <p className="font-bold text-sm mb-2">
            Replay: {replay.busNumber} · {replay.routeName || '—'}
          </p>
          <TripPlayer trip={replay} />
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!trips && !error && <p className="text-sm text-slate-500 animate-pulse">Loading trips…</p>}

      {trips && trips.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">
          No trips recorded yet. Completed driver trips appear here once drivers
          have finished them.
        </div>
      )}

      {trips && trips.length > 0 && (
        <ul className="card divide-y divide-slate-100 dark:divide-night-700 overflow-hidden">
          {trips.map((t) => (
            <li key={t.id} className="flex items-center gap-3 p-3">
              <div className="flex-1 min-w-0">
                <span className="font-bold">{t.busNumber}</span>
                <span className="text-xs text-slate-500">
                  {' '}· {t.driverName || '—'} · {t.routeName || '—'}
                </span>
                <span className="block text-xs text-slate-400 truncate">
                  {t.startedAt ? new Date(t.startedAt).toLocaleString() : ''}
                  {t.durationMinutes != null ? ` · ${t.durationMinutes} min` : ''}
                </span>
              </div>
              <span className={`pill text-[10px] ${badge(t.status)}`}>{t.status}</span>
              <button className="btn-secondary !px-2 !py-1 !min-h-0 text-xs" onClick={() => setReplay(t)}>
                Replay
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


