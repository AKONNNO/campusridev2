import { useState } from 'react';
import { post, put, del } from '../../../lib/api.js';
import { STATUS_COLORS } from '../../../lib/format.js';

/**
 * BusesTab — CRUD for vehicles. Buses are assigned a route here (the driver
 * app's "assigned bus" flows from drivers.assigned_bus_id set in Drivers).
 */
const EMPTY = { busNumber: '', model: 'Coaster', capacity: 18, colour: '#0ea5e9', routeId: '' };

export default function BusesTab({ data }) {
  const { buses, routes, reload } = data;
  const [editing, setEditing] = useState(null); // null | 'new' | bus id
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const startNew = () => {
    setEditing('new');
    setForm(EMPTY);
    setNotice(null);
  };

  const startEdit = (b) => {
    setEditing(b.id);
    setForm({
      busNumber: b.busNumber,
      model: b.model || 'Coaster',
      capacity: b.capacity || 18,
      colour: b.colour || '#0ea5e9',
      routeId: b.routeId ?? '',
    });
    setNotice(null);
  };

  const cancel = () => {
    setEditing(null);
    setForm(EMPTY);
    setNotice(null);
  };

  const save = async () => {
    if (!form.busNumber.trim()) {
      setNotice('Bus number is required.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const body = {
        busNumber: form.busNumber.trim(),
        model: form.model.trim() || 'Coaster',
        capacity: Number(form.capacity) || 18,
        colour: form.colour,
        routeId: form.routeId ? Number(form.routeId) : null,
      };
      if (editing === 'new') await post('/api/admin/buses', body);
      else await put(`/api/admin/buses/${editing}`, body);
      await reload();
      cancel();
    } catch (err) {
      setNotice(err.message || 'Could not save bus.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b) => {
    if (!window.confirm(`Delete bus ${b.busNumber}?`)) return;
    try {
      await del(`/api/admin/buses/${b.id}`);
      await reload();
    } catch (err) {
      setNotice(err.message || 'Could not delete bus.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Buses ({buses.length})</h2>
        {editing === null && (
          <button className="btn-primary !py-2 !px-3 !min-h-0 text-sm" onClick={startNew}>
            + New bus
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
          <h3 className="font-semibold text-sm">
            {editing === 'new' ? 'New bus' : `Edit bus ${form.busNumber || `#${editing}`}`}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label">Bus number</label>
              <input
                className="input"
                value={form.busNumber}
                onChange={(e) => setForm({ ...form, busNumber: e.target.value })}
                placeholder="e.g. KN-104"
              />
            </div>
            <div>
              <label className="label">Model</label>
              <input
                className="input"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Capacity</label>
              <input
                className="input"
                type="number"
                min="1"
                max="200"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Colour</label>
              <input
                className="input !p-2 h-12"
                type="color"
                value={form.colour}
                onChange={(e) => setForm({ ...form, colour: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Route</label>
              <select
                className="input"
                value={form.routeId}
                onChange={(e) => setForm({ ...form, routeId: e.target.value })}
              >
                <option value="">Unassigned</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-secondary" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="card divide-y divide-slate-100 dark:divide-night-700 overflow-hidden">
        {buses.map((b) => (
          <li key={b.id} className="flex items-center gap-3 p-3">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: b.routeColour || b.colour || '#c9a227' }}
            />
            <div className="flex-1 min-w-0">
              <span className="font-bold">{b.busNumber}</span>
              <span className="text-xs text-slate-500">
                {' '}
                · {b.model} · {b.capacity} seats
              </span>
              <span className="block text-xs text-slate-400 truncate">
                {b.routeName || 'No route assigned'}
              </span>
            </div>
            <span className={`pill text-[10px] ${STATUS_COLORS[b.status] || 'bg-slate-200 text-slate-600'}`}>
              {b.status}
            </span>
            <button className="btn-secondary !px-2 !py-1 !min-h-0 text-xs" onClick={() => startEdit(b)}>
              Edit
            </button>
            <button className="btn-danger !px-2 !py-1 !min-h-0 text-xs" onClick={() => remove(b)}>
              Delete
            </button>
          </li>
        ))}
        {buses.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-500">No buses yet — add one above.</li>
        )}
      </ul>
    </div>
  );
}

