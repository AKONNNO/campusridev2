import { useState } from 'react';
import { post, put, del } from '../../../lib/api.js';

/**
 * DriversTab — create/edit/delete driver accounts and assign each to a bus.
 * PINs are bcrypt-hashed server-side; the PIN field is only required when
 * creating (leave blank to keep the existing PIN when editing).
 */
const EMPTY = { name: '', phone: '', pin: '', licenseNumber: '', assignedBusId: '' };

export default function DriversTab({ data }) {
  const { drivers, buses, reload } = data;
  const [editing, setEditing] = useState(null); // null | 'new' | driver id
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const startNew = () => {
    setEditing('new');
    setForm(EMPTY);
    setNotice(null);
  };
  const startEdit = (d) => {
    setEditing(d.id);
    setForm({
      name: d.name,
      phone: d.phone,
      pin: '',
      licenseNumber: d.licenseNumber || '',
      assignedBusId: d.assignedBusId ?? '',
    });
    setNotice(null);
  };
  const cancel = () => {
    setEditing(null);
    setForm(EMPTY);
    setNotice(null);
  };

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setNotice('Name and phone are required.');
      return;
    }
    if (editing === 'new' && form.pin.length < 4) {
      setNotice('A PIN of at least 4 characters is required for new drivers.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        pin: form.pin || undefined,
        licenseNumber: form.licenseNumber.trim() || null,
        assignedBusId: form.assignedBusId ? Number(form.assignedBusId) : null,
      };
      if (editing === 'new') await post('/api/admin/drivers', body);
      else await put(`/api/admin/drivers/${editing}`, body);
      await reload();
      cancel();
    } catch (err) {
      setNotice(err.message || 'Could not save driver.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete driver ${d.name}? This also removes their login.`)) return;
    try {
      await del(`/api/admin/drivers/${d.id}`);
      await reload();
    } catch (err) {
      setNotice(err.message || 'Could not delete driver.');
    }
  };

  const toggleActive = async (d) => {
    try {
      await put(`/api/admin/drivers/${d.id}`, { isActive: !d.active });
      await reload();
    } catch (err) {
      setNotice(err.message || 'Could not update driver.');
    }
  };

  const busName = (busId) => buses.find((b) => b.id === Number(busId))?.busNumber || '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Drivers ({drivers.length})</h2>
        {editing === null && (
          <button className="btn-primary !py-2 !px-3 !min-h-0 text-sm" onClick={startNew}>
            + New driver
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
          <h3 className="font-semibold text-sm">{editing === 'new' ? 'New driver' : `Edit ${form.name}`}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">{editing === 'new' ? 'PIN' : 'New PIN (blank = keep)'}</label>
              <input className="input" type="password" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} />
            </div>
            <div>
              <label className="label">License number</label>
              <input className="input" value={form.licenseNumber} onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Assigned bus</label>
              <select className="input" value={form.assignedBusId} onChange={(e) => setForm({ ...form, assignedBusId: e.target.value })}>
                <option value="">Unassigned</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>{b.busNumber} ({b.model})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      <ul className="card divide-y divide-slate-100 dark:divide-night-700 overflow-hidden">
        {drivers.map((d) => (
          <li key={d.id} className="flex items-center gap-3 p-3">
            <div className="flex-1 min-w-0">
              <span className="font-bold">{d.name}</span>
              <span className="text-xs text-slate-500"> · {d.phone}</span>
              <span className="block text-xs text-slate-400 truncate">
                Bus {busName(d.assignedBusId)} · licence {d.licenseNumber || '—'}
              </span>
            </div>
            <button
              className={`pill text-[10px] ${d.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40' : 'bg-slate-200 text-slate-500'}`}
              onClick={() => toggleActive(d)}
              title="Toggle active"
            >
              {d.active ? 'active' : 'inactive'}
            </button>
            <button className="btn-secondary !px-2 !py-1 !min-h-0 text-xs" onClick={() => startEdit(d)}>Edit</button>
            <button className="btn-danger !px-2 !py-1 !min-h-0 text-xs" onClick={() => remove(d)}>Delete</button>
          </li>
        ))}
        {drivers.length === 0 && (
          <li className="p-6 text-center text-sm text-slate-500">No drivers yet.</li>
        )}
      </ul>
    </div>
  );
}

