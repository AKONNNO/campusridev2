import { useMemo, useState } from 'react';
import { get, post } from '../../lib/api.js';
import {
  formatEta,
  formatMinutes,
  timeAgo,
  directionName,
  STATUS_LABELS,
  STATUS_COLORS,
} from '../../lib/format.js';
import { haversineM, walkText } from '../../lib/clientGeo.js';

/**
 * Panels — the bottom sheet floating over the student map.
 *
 * One composable UI hosting the student tools:
 *   Live    — running buses (sorted by distance) + a pinned bus detail card
 *             (number, route + colour, speed, heading/direction, next stop +
 *             ETA, last updated, status, upcoming stops with ETAs)
 *   Stops   — search, nearest stops (+ walking time), "nearest bus to me",
 *             favourites and every stop
 *   Plan    — trip planner (pickup → destination via /api/trip-plan)
 *   Alerts  — "notify me when a bus is X minutes away" (in-app + browser)
 *   Feedback — report a problem / suggest an improvement (no account needed)
 *
 * It only touches the network for the trip-planner search; everything else
 * renders already-loaded state so the sheet works offline.
 */

const TABS = [
  { id: 'live', label: 'Live', icon: '🚌' },
  { id: 'stops', label: 'Stops', icon: '📍' },
  { id: 'plan', label: 'Plan', icon: '🗺️' },
  { id: 'alerts', label: 'Alerts', icon: '🔔' },
  { id: 'feedback', label: 'Feedback', icon: '💬' },
];

/** Sort live buses by straight-line distance from the student (client-side). */
function sortByDistance(busList, myLoc) {
  if (!myLoc || busList.length < 2) return busList;
  return [...busList].sort((a, b) => {
    const da = a.lat != null ? haversineM(myLoc.lat, myLoc.lng, a.lat, a.lng) : Infinity;
    const db = b.lat != null ? haversineM(myLoc.lat, myLoc.lng, b.lat, b.lng) : Infinity;
    return da - db;
  });
}

/* --------------------------------------------------------- Feedback tab */
function FeedbackTab({ stops, busList }) {
  const [form, setForm] = useState({ message: '', contact: '', stopId: '', busId: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const submit = async () => {
    if (!form.message.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await post('/api/feedback', {
        message: form.message.trim(),
        contact: form.contact.trim() || undefined,
        stopId: form.stopId ? Number(form.stopId) : undefined,
        busId: form.busId ? Number(form.busId) : undefined,
      });
      setNotice({ kind: 'ok', text: 'Thanks! Your feedback was sent.' });
      setForm({ message: '', contact: '', stopId: '', busId: '' });
    } catch (err) {
      setNotice({ kind: 'err', text: err.message || 'Could not send feedback.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Report a problem (a full bus, a late route…) or suggest an improvement.
        No account needed.
      </p>

      {notice && (
        <p
          className={`text-sm rounded-xl px-3 py-2 ${
            notice.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {notice.text}
        </p>
      )}

      <textarea
        className="input min-h-[100px]"
        placeholder="What happened? e.g. The 5pm Campus Loop was too full again…"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
      />
      <input
        className="input"
        placeholder="Contact (optional — so we can reply)"
        value={form.contact}
        onChange={(e) => setForm({ ...form, contact: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={form.stopId} onChange={(e) => setForm({ ...form, stopId: e.target.value })}>
          <option value="">Related stop…</option>
          {stops.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select className="input" value={form.busId} onChange={(e) => setForm({ ...form, busId: e.target.value })}>
          <option value="">Related bus…</option>
          {busList.map((b) => (
            <option key={b.busId} value={b.busId}>{b.busNumber}</option>
          ))}
        </select>
      </div>
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.message.trim()}>
        {busy ? 'Sending…' : 'Send feedback'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Live tab */
function LiveTab({ busList, myLoc, selBusId, onSelectBus }) {
  const sorted = useMemo(() => sortByDistance(busList, myLoc), [busList, myLoc]);

  if (sorted.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        <div className="text-3xl mb-2">🕳️</div>
        No buses are running right now. When a driver starts a trip it appears
        here and on the map.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-night-700">
      {sorted.map((b) => {
        const offline = b.status === 'offline' || b.lat == null;
        const next = b.nextStop;
        return (
          <li key={b.busId}>
            <button
              className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-night-700 rounded-lg px-1"
              onClick={() => onSelectBus(b)}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: offline ? '#94a3b8' : b.route?.colour }}
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                  <span className="font-bold">{b.busNumber}</span>
                  <span className="text-xs text-slate-500 truncate">{b.route?.name}</span>
                  {selBusId === b.busId && (
                    <span className="pill bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                      pinned
                    </span>
                  )}
                </span>
                <span className="block text-xs text-slate-600 dark:text-slate-300 truncate">
                  {next ? `Next: ${next.stopName} · ${formatEta(next.etaSeconds)}` : 'No stop data yet'}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className={`pill text-[10px] ${STATUS_COLORS[b.status] || STATUS_COLORS.offline}`}>
                  {STATUS_LABELS[b.status] || b.status}
                </span>
                <span className="block text-[10px] text-slate-400 mt-0.5">{timeAgo(b.lastUpdate)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------- Pinned bus (Live tab) */
function BusCard({ bus, onSelectStop }) {
  const stops = bus.upcomingStops || [];
  const next = bus.nextStop;
  return (
    <section className="rounded-xl border border-slate-200 dark:border-night-700 bg-slate-50 dark:bg-night-900/40 p-3 mb-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: bus.route?.colour }} />
        <span className="font-bold text-lg">{bus.busNumber}</span>
        <span className="text-xs text-slate-500">{bus.route?.name}</span>
        <span className={`pill text-[10px] ${STATUS_COLORS[bus.status] || STATUS_COLORS.offline}`}>
          {STATUS_LABELS[bus.status] || bus.status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-slate-600 dark:text-slate-300">
        <div>
          <span className="block text-[10px] uppercase text-slate-400">Speed</span>
          {bus.speedKmh > 0 ? `${bus.speedKmh} km/h` : '—'}
        </div>
        <div>
          <span className="block text-[10px] uppercase text-slate-400">Heading</span>
          {directionName(bus.heading)} ({Math.round(bus.heading)}°)
        </div>
        <div>
          <span className="block text-[10px] uppercase text-slate-400">Updated</span>
          {timeAgo(bus.lastUpdate)}
        </div>
      </div>

      {next && (
        <p className="text-sm mt-2">
          Next stop:{' '}
          <strong>
            <button
              className="underline decoration-dotted"
              onClick={() => onSelectStop?.(next.stopId)}
            >
              {next.stopName}
            </button>
          </strong>{' '}
          <span className="text-slate-500">({formatEta(next.etaSeconds)})</span>
        </p>
      )}

      {stops.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
          {stops.map((s, i) => (
            <li key={`${s.stopId}-${i}`} className="flex justify-between gap-2">
              <span className={s.isNext ? 'font-semibold' : ''}>{s.stopName}</span>
              <span className="text-slate-500">{formatEta(s.etaSeconds)}</span>
            </li>
          ))}
        </ul>
      )}

      {bus.status === 'offline' && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          No position update for 60 seconds — this bus is offline.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ Stops tab */
function StopsTab({
  stops,
  routes,
  myLoc,
  nearestList,
  selStopId,
  onSelectStop,
  favs,
  isFav,
  onToggleFav,
  busList,
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return stops;
    return stops.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        (s.code || '').toLowerCase().includes(query) ||
        routes.some(
          (r) => r.stops?.some((rs) => rs.id === s.id) && r.name.toLowerCase().includes(query)
        )
    );
  }, [stops, routes, query]);

  const nearest = nearestList[0] || null;

  // "Nearest bus to me" — the bus that will reach my nearest stop soonest.
  const nearestBus = useMemo(() => {
    if (!nearest) return null;
    let best = null;
    for (const b of busList) {
      const match = (b.upcomingStops || []).find((s) => s.stopId === nearest.id);
      if (match && (!best || match.etaSeconds < best.etaSeconds)) {
        best = { bus: b, etaSeconds: match.etaSeconds };
      }
    }
    return best;
  }, [nearest, busList]);

  const favStops = useMemo(() => {
    const map = new Map(stops.map((s) => [s.id, s]));
    return favs.map((f) => map.get(f.stopId)).filter(Boolean);
  }, [favs, stops]);

  const Row = ({ s, sub, inFavList = false }) => (
    <button
      className={`w-full flex items-center gap-3 py-2.5 text-left rounded-lg px-2 hover:bg-slate-50 dark:hover:bg-night-700 ${
        selStopId === s.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''
      }`}
      onClick={() => onSelectStop(s)}
    >
      <span className="w-2 h-2 rounded-full shrink-0 bg-brand-400" />
      <span className="flex-1 min-w-0">
        <span className="font-semibold block truncate">{s.name}</span>
        {sub && <span className="text-xs text-slate-500 block truncate">{sub}</span>}
      </span>
      <span
        role="button"
        tabIndex={0}
        className="text-lg shrink-0 px-1 select-none"
        aria-label={isFav(s.id) ? 'Remove from favourites' : 'Add to favourites'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav(s);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            onToggleFav(s);
          }
        }}
      >
        {isFav(s.id) ? '★' : '☆'}
      </span>
      <span className="text-[10px] text-slate-400 shrink-0">{s.code}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <input
        className="input !py-2.5"
        type="search"
        placeholder="Search stops or routes…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {!myLoc && (
        <p className="text-xs text-slate-400 px-1">
          Tip: tap “Locate me” in the header to see your nearest stops, the
          walking time, and the shortest walk marked on the map.
        </p>
      )}

      {myLoc && nearest && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 px-1 mb-1">
            Nearest stop to you
          </h3>
          <ul>
            <li>
              <Row s={nearest} sub={walkText(nearest.distanceM)} />
            </li>
          </ul>
          {nearestBus && (
            <div className="rounded-xl border border-slate-200 dark:border-night-700 p-3 mt-1 bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-sm">
                <span className="font-bold">{nearestBus.bus.busNumber}</span> will reach{' '}
                <strong>{nearest.name}</strong> soonest — in{' '}
                <span className="font-bold">{formatEta(nearestBus.etaSeconds)}</span>.
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {nearestBus.bus.route?.name} · {STATUS_LABELS[nearestBus.bus.status] || nearestBus.bus.status}
              </p>
            </div>
          )}
        </section>
      )}

      {myLoc && nearestList.length > 1 && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 px-1 mb-1">
            Nearby
          </h3>
          <ul className="divide-y divide-slate-100 dark:divide-night-700">
            {nearestList.slice(1).map((s) => (
              <li key={s.id}>
                <Row s={s} sub={walkText(s.distanceM)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {favStops.length > 0 && (
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 px-1 mb-1">
            ★ Favourites
          </h3>
          <ul className="divide-y divide-slate-100 dark:divide-night-700">
            {favStops.map((s) => (
              <li key={s.id}>
                <Row s={s} inFavList />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 px-1 mb-1">
          {query ? `${filtered.length} matching` : 'All stops'}
        </h3>
        <ul className="divide-y divide-slate-100 dark:divide-night-700">
          {filtered.map((s) => (
            <li key={s.id}>
              <Row s={s} />
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-1 py-4 text-sm text-slate-400 text-center">No stops match “{q}”.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- Stop detail */
function StopDetail({ stop, routes, busList, alerts, isFav, onToggleFav, onAddAlert, onClose }) {
  const serving = routes.filter((r) => r.stops?.some((s) => s.id === stop.id));
  const arrivals = useMemo(() => {
    const out = [];
    for (const b of busList) {
      const match = (b.upcomingStops || []).find((s) => s.stopId === stop.id);
      if (match) out.push({ ...b, etaSeconds: match.etaSeconds });
    }
    return out.sort((a, b) => a.etaSeconds - b.etaSeconds);
  }, [busList, stop.id]);
  const alreadyAlerted = alerts.some((a) => a.stopId === stop.id);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="font-bold text-lg">{stop.name}</h2>
          <p className="text-xs text-slate-500">{stop.code}</p>
        </div>
        <button className="btn-secondary !px-3 !py-1.5 !min-h-0 text-sm" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {serving.map((r) => (
          <span key={r.id} className="pill" style={{ background: `${r.colour}22`, color: r.colour }}>
            ● {r.name}
          </span>
        ))}
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">
          Arriving buses
        </h3>
        {arrivals.length === 0 ? (
          <p className="text-sm text-slate-500">No buses are heading this way right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-night-700">
            {arrivals.map((b) => (
              <li key={b.busId} className="flex items-center gap-3 py-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: b.route?.colour }} />
                <span className="flex-1 font-semibold text-sm">{b.busNumber}</span>
                <span className="text-sm text-slate-500">
                  {b.speedKmh > 0 ? `${b.speedKmh} km/h · ` : ''}
                  {formatEta(b.etaSeconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <button
          className="btn-secondary flex-1 !py-2.5 text-sm"
          onClick={() => onAddAlert?.(stop)}
          disabled={alreadyAlerted}
        >
          {alreadyAlerted ? '🔔 Alert set' : '🔔 Notify me when close'}
        </button>
        <button
          className={`btn-secondary !py-2.5 text-sm ${
            isFav(stop.id) ? '!text-brand-600 dark:!text-brand-300' : ''
          }`}
          onClick={() => onToggleFav(stop)}
        >
          {isFav(stop.id) ? '★ Saved' : '☆ Save'}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Plan tab */
function PlannerTab({ stops }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const canSearch = !!from && !!to && from !== to && !busy;

  const search = async () => {
    if (!from || !to) return;
    if (from === to) {
      setError('Pickup and destination must differ.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await get(`/api/trip-plan?from=${from}&to=${to}`);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Could not plan this trip.');
    } finally {
      setBusy(false);
    }
  };

  const stopName = (id) => stops.find((s) => s.id === Number(id))?.name || '—';

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="plan-from">From</label>
        <select id="plan-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="" disabled>Choose a stop…</option>
          {stops.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="plan-to">To</label>
        <select id="plan-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="" disabled>Choose a stop…</option>
          {stops.map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.id === from ? ' (current pickup)' : ''}</option>
          ))}
        </select>
      </div>

      <button className="btn-primary w-full" onClick={search} disabled={!canSearch}>
        {busy
          ? 'Planning…'
          : from && to && from !== to
            ? `Plan ${stopName(from)} → ${stopName(to)}`
            : 'Pick both stops'}
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            {result.options?.length
              ? `${result.options.length} option${result.options.length > 1 ? 's' : ''} found`
              : result.message || 'No routes found.'}
          </p>
          {(result.options || []).map((opt) => (
            <div key={opt.route.id} className="rounded-xl border border-slate-200 dark:border-night-700 p-3">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: opt.route.colour }} />
                <span className="font-semibold text-sm">{opt.route.name}</span>
                <span className="text-xs text-slate-500 ml-auto">~{formatEta(opt.rideTimeSeconds)} ride</span>
              </div>
              {opt.buses && opt.buses.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {opt.buses.map((b) => (
                    <li key={b.busId} className="flex justify-between gap-2">
                      <span>{b.busNumber} · pickup in {formatEta(b.etaToPickupSeconds)}</span>
                      <span className="text-slate-500">{formatEta(b.rideTimeSeconds)} ride</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-400">No bus is live right now — check back soon.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Alerts tab */
function AlertsTab({ stops, alerts, onAddAlertStop, onRemoveAlert }) {
  const [stopId, setStopId] = useState('');
  const [minutes, setMinutes] = useState('10');

  const add = () => {
    if (!stopId) return;
    const stop = stops.find((s) => s.id === Number(stopId));
    onAddAlertStop?.(stop, Number(minutes));
    setStopId('');
  };

  return (
    <div className="space-y-3">
      {alerts.length === 0 ? (
        <p className="text-sm text-slate-500">
          No arrival alerts yet. Choose a stop and a lead time below — we’ll ping
          you (in-app + browser notification) when a bus is about to get there.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-night-700">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-2">
              <span className="flex-1 text-sm">
                <span className="font-semibold">{a.stopName}</span>
                <span className="text-slate-500"> · within {formatMinutes(a.minutes)}</span>
              </span>
              <button
                className="btn-secondary !px-3 !py-1 !min-h-0 text-xs"
                onClick={() => onRemoveAlert(a.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-night-700 p-3 space-y-2">
        <label className="label" htmlFor="alert-stop">Stop</label>
        <select id="alert-stop" className="input" value={stopId} onChange={(e) => setStopId(e.target.value)}>
          <option value="" disabled>Choose a stop…</option>
          {stops.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <label className="label" htmlFor="alert-mins">Lead time</label>
        <select id="alert-mins" className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
          {[5, 10, 15, 20, 30].map((m) => (
            <option key={m} value={m}>{formatMinutes(m)}</option>
          ))}
        </select>
        <button className="btn-primary w-full !py-2.5" onClick={add} disabled={!stopId}>
          Set arrival alert
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Bottom sheet */
export default function Panels({
  tab,
  setTab,
  open,
  setOpen,
  busList,
  myLoc,
  stops,
  routes,
  selBus,
  selStop,
  nearestList = [],
  favs,
  isFav,
  onToggleFav,
  onSelectBus,
  onSelectStop,
  onClearSelStop,
  onAddAlertStop,
  onRemoveAlert,
  alerts,
  online,
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-[1000] pointer-events-none">
      <div className="mx-auto max-w-md w-full pointer-events-auto">
        <div className="card rounded-2xl rounded-b-none shadow-xl overflow-hidden">
          {/* grip */}
          <button
            aria-label={open ? 'Collapse panel' : 'Expand panel'}
            className="w-full pt-1.5 pb-0.5 flex justify-center"
            onClick={() => setOpen(!open)}
          >
            <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-night-700 hover:bg-slate-400" />
          </button>

          {/* tab bar (always visible) */}
          <div className="grid grid-cols-5 border-b border-slate-100 dark:border-night-700">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs font-semibold transition-colors ${
                  tab === t.id
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
                onClick={() => {
                  setTab(t.id);
                  if (!open) setOpen(true);
                  if (t.id !== 'stops') onClearSelStop?.();
                }}
              >
                <span className="text-lg leading-none">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          {open && (
            <div className="max-h-[52dvh] overflow-y-auto scroll-thin p-3">
              {selStop ? (
                <StopDetail
                  stop={selStop}
                  routes={routes}
                  busList={busList}
                  alerts={alerts}
                  isFav={isFav}
                  onToggleFav={onToggleFav}
                  onAddAlert={onAddAlertStop}
                  onClose={onClearSelStop}
                />
              ) : (
                <>
                  {tab === 'live' && selBus && <BusCard bus={selBus} onSelectStop={onSelectStop} />}
                  {tab === 'live' && (
                    <LiveTab busList={busList} myLoc={myLoc} selBusId={selBus?.busId} onSelectBus={onSelectBus} />
                  )}
                  {tab === 'stops' && (
                    <StopsTab
                      stops={stops}
                      routes={routes}
                      myLoc={myLoc}
                      nearestList={nearestList}
                      selStopId={selStop?.id}
                      onSelectStop={onSelectStop}
                      favs={favs}
                      isFav={isFav}
                      onToggleFav={onToggleFav}
                      busList={busList}
                    />
                  )}
                  {tab === 'plan' && <PlannerTab stops={stops} />}
                  {tab === 'alerts' && (
                    <AlertsTab
                      stops={stops}
                      alerts={alerts}
                      onAddAlertStop={onAddAlertStop}
                      onRemoveAlert={onRemoveAlert}
                    />
                  )}
                  {tab === 'feedback' && (
                    <FeedbackTab stops={stops} busList={busList} />
                  )}
                </>
              )}
              {!online && (
                <p className="mt-3 text-center text-[11px] text-slate-400">
                  Offline — showing the last cached data.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


