import { useState } from 'react';
import { post, put, del } from '../../../lib/api.js';
import AdminMap from '../AdminMap.jsx';

/**
 * StopsTab — CRUD for stops. Coordinates are set by clicking on the map
 * (mode 'place-stop'): every click drops a draft marker and fills lat/lng.
 */
const EMPTY = { name: '', code: '', lat: null, lng: null };

export default function StopsTab({ data }) {
  const { stops, routes, reload } = data;
  const [editing, setEditing] = useState(null); // null | 'new' | stop id
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const startNew = () => {
    setEditing('new');
    setForm(EMPTY);
    setNotice(null);
  };
  const startEdit = (s) => {
    setEditing(s.id);
    setForm({ name: s.name, code: s.code || '', lat: s.lat, lng: s.lng });
    setNotice(null);
  };
  const cancel = () => {
    setEditing(null);
    setForm(EMPTY);
    setNotice(null);
  };

  const onMapClick = (p) => setForm((f) => ({ ...f, lat: p.lat, lng: p.lng }));

  const save = async () => {
    if (!form.name.trim()) {
      setNotice('Stop name is required.');
      return;
    }
    if (form.lat == null || form.lng == null) {
      setNotice('Click the map to place the stop first.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        lat: form.lat,
        lng: form.lng,
      };
      if (editing === 'new') await post('/api/admin/stops', body);
      else await put(`/api/admin/stops/${editing}`, body);
      await reload();
      cancel();
    } catch (err) {
      setNotice(err.message || 'Could not save stop.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete stop ${s.name}?`)) return;
    try {
      await del(`/api/admin/stops/${s.id}`);
      await reload();
    } catch (err) {
      setNotice(err.message || 'Could not delete stop.');
    }
  };

  const servingCount = (stopId) =>
    routes.filter((r) => r.stops?.some((s) => s.stopId === stopId)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Stops ({stops.length})</h2>
        {editing === null && (
          <button className="btn-primary !py-2 !px-3 !min-h-0 text-sm" onClick={startNew}>
            + New stop
          </button>
        )}
      </div>

      {notice && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}

      {editing !== null && (
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm">{editing === 'new' ? 'New stop' : `Edit ${form.name || `#${editing}`}`}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Queens Hall" />
            </div>
            <div>
              <label className="label">Code</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ST-13" />
            </div>
          </div>

          <div>
            <p className="label mb-1">Position — click the map to place it</p>
            <AdminMap
              routes={routes}
              stops={stops}
              mode="place-stop"
              draftPoint={form.lat != null ? { lat: form.lat, lng: form.lng } : null}
              onMapClick={onMapClick}
            />
            <p className="text-xs text-slate-500 mt-1 font-mono">
              {form.lat != null ? `${form.lat.toFixed(6)}, ${form.lng.toFixed(6)}` : 'No position yet'}
            </p>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="card divide-y divide-slate-100 dark:divide-night-700 overflow-hidden">
        {stops.map((s) => (
          <li key={s.id} className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <span className="font-bold">{s.name}</span>
              <span className="text-xs text-slate-500"> · {s.code || '—'}</span>
              <span className="block text-xs text-slate-400 truncate">
                {s.lat?.toFixed(5)}, {s.lng?.toFixed(5)} · {servingCount(s.id)} route(s)
              </span>
            </div>
            <button className="btn-secondary !px-2 !py-1 !min-h-0 text-xs" onClick={() => startEdit(s)}>Edit</button>
            <button className="btn-danger !px-2 !py-1 !min-h-0 text-xs" onClick={() => remove(s)}>Delete</button>
          </li>
        ))}
        {stops.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-500">No stops yet — add one above.</li>
        )}
      </ul>
    </div>
  );
}
