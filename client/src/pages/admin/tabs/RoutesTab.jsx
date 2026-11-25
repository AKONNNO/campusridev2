import { useState } from 'react';
import { post, put, del } from '../../../lib/api.js';
import AdminMap from '../AdminMap.jsx';

/**
 * RouteStopOrder — the ordered stop list for a route, with HTML5 drag-to-
 * reorder (works on desktop; the sequence numbers update as you drag). Stops
 * are added from the whole stop list and removed per row.
 */
function RouteStopOrder({ assigned, onReorder, onRemove, allStops, onAdd }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);

  const handleDrop = (index) => {
    if (drag != null && drag !== index) onReorder(drag, index);
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Add stops, then drag them to set the travel order.</p>
      <div className="flex flex-wrap gap-1.5">
        {allStops.map((s) => {
          const added = assigned.some((a) => a.stopId === s.id);
          return (
            <button
              key={s.id}
              className={`pill ${added ? 'opacity-40 line-through' : 'bg-slate-100 dark:bg-night-700 text-slate-600 dark:text-slate-300'}`}
              onClick={() => onAdd(s.id)}
              disabled={added}
            >
              + {s.name}
            </button>
          );
        })}
      </div>
      <ol className="space-y-1.5">
        {assigned.map((s, i) => (
          <li
            key={s.stopId}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={() => handleDrop(i)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 cursor-grab active:cursor-grabbing ${
              over === i
                ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/20'
                : 'border-slate-200 dark:border-night-700'
            }`}
          >
            <span className="text-slate-400 select-none">⠿</span>
            <span className="w-5 h-5 rounded-full text-[10px] font-bold bg-brand-500 text-night flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <span className="flex-1 text-sm truncate">{s.name}</span>
            <button className="btn-danger !px-2 !py-0.5 !min-h-0 text-xs" onClick={() => onRemove(s.stopId)}>
              ✕
            </button>
          </li>
        ))}
        {assigned.length === 0 && (
          <li className="text-sm text-slate-400">No stops on this route yet.</li>
        )}
      </ol>
    </div>
  );
}

/** Move an element in an array from `from` to `to`. */
function moveItem(arr, from, to) {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Parse a GeoJSON LineString / Feature / FeatureCollection into lat/lng points. */
function geojsonToPoints(text) {
  const obj = JSON.parse(text);
  let geom = obj;
  if (obj.type === 'Feature') geom = obj.geometry;
  if (obj.type === 'FeatureCollection') {
    const fs = obj.features.map((f) => f.geometry);
    const line = fs.find((g) => g && g.type === 'LineString');
    if (line) geom = line;
  }
  if (!geom || geom.type !== 'LineString') {
    throw new Error('Expected a GeoJSON LineString (coords = [[lng,lat],...]).');
  }
  return geom.coordinates.map(([lng, lat]) => ({ lat, lng }));
}

const EMPTY_FORM = { name: '', code: '', colour: '#0ea5e9', isLoop: true, isActive: true };

export default function RoutesTab({ data }) {
  const { routes, stops, reload } = data;
  const [editing, setEditing] = useState(null); // null | 'new' | route id
  const [form, setForm] = useState(EMPTY_FORM);
  const [path, setPath] = useState([]); // [{lat,lng}] — drawn/loaded points
  const [assigned, setAssigned] = useState([]); // [{stopId, name}]
  const [geojson, setGeojson] = useState('');
  const [geoErr, setGeoErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const startNew = () => {
    setEditing('new');
    setForm(EMPTY_FORM);
    setPath([]);
    setAssigned([]);
    setGeojson('');
    setGeoErr(null);
    setNotice(null);
  };

  const startEdit = (r) => {
    setEditing(r.id);
    setForm({
      name: r.name,
      code: r.code,
      colour: r.colour,
      isLoop: !!r.isLoop,
      isActive: r.isActive ?? true,
    });
    setPath((r.path || []).map((p) => ({ lat: p.lat, lng: p.lng })));
    setAssigned((r.stops || []).map((s) => ({ stopId: s.stopId, name: s.name })));
    setGeojson('');
    setGeoErr(null);
    setNotice(null);
  };

  const cancel = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPath([]);
    setAssigned([]);
    setGeojson('');
    setGeoErr(null);
    setNotice(null);
  };

  const onMapClick = (p) => setPath((prev) => [...prev, p]);
  const undoPoint = () => setPath((prev) => prev.slice(0, -1));
  const clearPath = () => setPath([]);

  const importGeo = () => {
    try {
      setPath(geojsonToPoints(geojson));
      setGeoErr(null);
    } catch (err) {
      setGeoErr(err.message);
    }
  };

  const addStop = (stopId) => {
    if (assigned.some((a) => a.stopId === stopId)) return;
    const stop = stops.find((s) => s.id === stopId);
    if (stop) setAssigned((prev) => [...prev, { stopId: stop.id, name: stop.name }]);
  };
  const removeStop = (stopId) => setAssigned((prev) => prev.filter((a) => a.stopId !== stopId));
  const reorder = (from, to) => setAssigned((prev) => moveItem(prev, from, to));

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      setNotice('Name and code are required.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim(),
        colour: form.colour,
        isLoop: form.isLoop,
        isActive: form.isActive,
        coordinates: path.length >= 2 ? path.map((p) => [p.lng, p.lat]) : undefined,
        stops: assigned.length
          ? assigned.map((a, i) => ({ stopId: a.stopId, sequence: i + 1 }))
          : undefined,
      };
      if (editing === 'new') await post('/api/admin/routes', body);
      else await put(`/api/admin/routes/${editing}`, body);
      await reload();
      cancel();
    } catch (err) {
      setNotice(err.message || 'Could not save route.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete route ${r.name}?`)) return;
    try {
      await del(`/api/admin/routes/${r.id}`);
      await reload();
    } catch (err) {
      setNotice(err.message || 'Could not delete route.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Routes ({routes.length})</h2>
        {editing === null && (
          <button className="btn-primary !py-2 !px-3 !min-h-0 text-sm" onClick={startNew}>
            + New route
          </button>
        )}
      </div>

      {notice && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}

      {editing !== null && (
        <div className="card p-4 space-y-4">
          <h3 className="font-semibold text-sm">{editing === 'new' ? 'New route' : `Edit ${form.name}`}</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Queens Shuttle" />
            </div>
            <div>
              <label className="label">Code</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="R4" />
            </div>
            <div>
              <label className="label">Colour</label>
              <input className="input !p-2 h-12" type="color" value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} />
            </div>
            <div className="col-span-2 sm:col-span-1 flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.isLoop} onChange={(e) => setForm({ ...form, isLoop: e.target.checked })} />
                Loop route
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Active
              </label>
            </div>
          </div>

          <div>
            <p className="label mb-1">Route path — click the map to draw each point</p>
            <AdminMap
              routes={routes}
              stops={stops}
              mode="draw-route"
              routePoints={path}
              onMapClick={onMapClick}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              <button className="btn-secondary !py-1 !px-2 !min-h-0 text-xs" onClick={undoPoint} disabled={path.length === 0}>
                Undo last point
              </button>
              <button className="btn-secondary !py-1 !px-2 !min-h-0 text-xs" onClick={clearPath} disabled={path.length === 0}>
                Clear
              </button>
              <span className="text-xs text-slate-500 self-center">{path.length} point(s)</span>
            </div>
          </div>

          <div>
            <label className="label">…or paste a GeoJSON LineString</label>
            <textarea
              className="input min-h-[70px] font-mono text-xs"
              value={geojson}
              onChange={(e) => setGeojson(e.target.value)}
              placeholder='{"type":"LineString","coordinates":[[-1.5760,6.6795],[-1.5780,6.6773],...]}'
            />
            <button className="btn-secondary !py-1 !px-2 !min-h-0 text-xs mt-1" onClick={importGeo}>
              Load from GeoJSON
            </button>
            {geoErr && <p className="text-xs text-red-600 mt-1">{geoErr}</p>}
          </div>

          <div>
            <RouteStopOrder
              assigned={assigned}
              allStops={stops}
              onAdd={addStop}
              onRemove={removeStop}
              onReorder={reorder}
            />
          </div>

          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save route'}
            </button>
            <button className="btn-secondary" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="card divide-y divide-slate-100 dark:divide-night-700 overflow-hidden">
        {routes.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-3">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.colour }} />
            <div className="flex-1 min-w-0">
              <span className="font-bold">{r.name}</span>
              <span className="text-xs text-slate-500"> ({r.code})</span>
              <span className="block text-xs text-slate-400 truncate">
                {r.isLoop ? 'Loop' : 'Out & back'} · {r.stops?.length ?? 0} stops ·{' '}
                {r.totalDistanceM ? `${Math.round(r.totalDistanceM)} m` : 'no path'}
                {!r.isActive ? ' · inactive' : ''}
              </span>
            </div>
            <button className="btn-secondary !px-2 !py-1 !min-h-0 text-xs" onClick={() => startEdit(r)}>Edit</button>
            <button className="btn-danger !px-2 !py-1 !min-h-0 text-xs" onClick={() => remove(r)}>Delete</button>
          </li>
        ))}
        {routes.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-500">No routes yet — add one above.</li>
        )}
      </ul>
    </div>
  );
}


