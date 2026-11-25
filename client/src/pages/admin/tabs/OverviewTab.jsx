import { useMemo, useRef } from 'react';
import { useLiveBuses } from '../../student/useLiveBuses.js';
import AdminMap from '../AdminMap.jsx';

/**
 * OverviewTab — live map of every bus, quick fleet stats and a tap-to-inspect
 * bus card. Reuses the student live-bus hook (same REST seed + socket feed).
 */
export default function OverviewTab({ routes, stops }) {
  const { busList, connected } = useLiveBuses(true);
  const mapRef = useRef(null);

  const stats = useMemo(
    () => ({
      active: busList.filter((b) => b.status === 'on_trip').length,
      offline: busList.filter((b) => b.status === 'offline').length,
      routes: routes.filter((r) => r.isActive).length,
      stops: stops.length,
    }),
    [busList, routes, stops]
  );

  const handleBusClick = (bus) => {
    mapRef.current?.flyTo([bus.lat, bus.lng], 16, { duration: 0.6 });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3">
          <p className="text-xs text-slate-500 uppercase">Live</p>
          <p className="text-2xl font-black">{stats.active}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500 uppercase">Offline</p>
          <p className="text-2xl font-black text-slate-500">{stats.offline}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500 uppercase">Routes</p>
          <p className="text-2xl font-black">{stats.routes}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-slate-500 uppercase">Stops</p>
          <p className="text-2xl font-black">{stats.stops}</p>
        </div>
      </div>

      <div className="card p-2">
        <div className="flex items-center justify-between px-2 pt-1 pb-2">
          <p className="font-bold text-sm">Live bus map</p>
          <span className={`pill ${connected ? 'bg-emerald-500 text-white' : 'bg-slate-400 text-white'}`}>
            {connected ? '● Live' : '○ Offline'}
          </span>
        </div>
        <AdminMap
          routes={routes}
          stops={stops}
          busList={busList}
          onBusClick={handleBusClick}
          onMap={(m) => {
            mapRef.current = m;
          }}
        />
      </div>

      {busList.length > 0 && (
        <div className="card p-3">
          <p className="font-bold text-sm mb-2">
            Buses now ({busList.length}) — tap a marker or a row
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-night-700">
            {busList.map((b) => (
              <li key={b.busId}>
                <button
                  className="w-full flex items-center gap-3 py-2.5 text-left"
                  onClick={() => handleBusClick(b)}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: b.route?.colour }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="font-bold">{b.busNumber}</span>
                    <span className="text-xs text-slate-500"> · {b.route?.name}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {b.speedKmh > 0 ? `${b.speedKmh} km/h · ` : ''}
                    {b.nextStop?.stopName || '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {busList.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">
          No buses are on a trip right now — start a trip from the driver app (
          <a href="#/driver" className="underline">/driver</a>).
        </div>
      )}
    </div>
  );
}
