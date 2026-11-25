import { useEffect, useState } from 'react';
import { get } from '../../../lib/api.js';

/**
 * ReportsTab — basic ops reports: trips per day (last 7 days), busiest stops
 * (by GPS hits within 150 m) and average completed-trip duration (a proxy for
 * the spec's "average delays", which the backend computes from history).
 */
export default function ReportsTab() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    get('/api/admin/reports/summary')
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setError(e.message || 'Could not load reports.'));
    return () => {
      alive = false;
    };
  }, []);

  if (error)
    return (
      <div className="card p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
    );
  if (!report)
    return (
      <div className="card p-6 text-center text-sm text-slate-500 animate-pulse">
        Loading reports…
      </div>
    );

  const weekTrips = (report.tripsPerDay || []).reduce((a, r) => a + Number(r.trips), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs text-slate-500 uppercase">Trips last 7 days</p>
          <p className="text-3xl font-black">{weekTrips}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 uppercase">Completed trips (all time)</p>
          <p className="text-3xl font-black">{report.durationInfo?.completedTrips ?? 0}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 uppercase">Avg trip duration</p>
          <p className="text-3xl font-black">
            {report.durationInfo?.avgDurationMinutes != null
              ? `${Math.round(Number(report.durationInfo.avgDurationMinutes))} min`
              : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-bold text-sm mb-2">Trips per day (last 7 days)</h3>
          {report.tripsPerDay?.length ? (
            <ul className="space-y-1 text-sm">
              {report.tripsPerDay.map((r) => (
                <li key={r.day} className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-300">{r.day}</span>
                  <span className="font-bold">{r.trips}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No trips recorded yet.</p>
          )}
        </div>

        <div className="card p-4">
          <h3 className="font-bold text-sm mb-2">Busiest stops (GPS hits)</h3>
          {report.busiestStops?.length ? (
            <ol className="space-y-1 text-sm">
              {report.busiestStops.map((s, i) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span>
                    <span className="text-slate-400 mr-2">{i + 1}.</span>
                    {s.name}
                  </span>
                  <span className="font-bold">{s.gpsHits}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-400">No GPS data yet.</p>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Heads-up: "average delays" is reported here as the average completed-trip
        duration (the backend derives it from trip history). Once scheduled
        timetables are added, actual-vs-scheduled delay can be layered on top.
      </p>
    </div>
  );
}
