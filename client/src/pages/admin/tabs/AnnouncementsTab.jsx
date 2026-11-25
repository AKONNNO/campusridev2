import { useState } from 'react';
import { post, del } from '../../../lib/api.js';

/**
 * AnnouncementsTab — post and remove announcements. New posts are broadcast
 * to every connected student/driver in real time via the `announcement:new`
 * socket event (the backend emits it). The list uses the public active list,
 * which is what students/drivers actually see.
 */
const KINDS = [
  { value: 'info', label: 'Info', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  { value: 'delay', label: 'Delay', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { value: 'breakdown', label: 'Breakdown', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { value: 'schedule', label: 'Schedule', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
];

const EMPTY = { kind: 'info', title: '', message: '', expiresAt: '' };

export default function AnnouncementsTab({ data }) {
  const { announcements, reload } = data;
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const save = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      setNotice('Title and message are required.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await post('/api/admin/announcements', {
        kind: form.kind,
        title: form.title.trim(),
        message: form.message.trim(),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      });
      setForm(EMPTY);
      await reload();
    } catch (err) {
      setNotice(err.message || 'Could not post announcement.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`Remove announcement “${a.title}”?`)) return;
    try {
      await del(`/api/admin/announcements/${a.id}`);
      await reload();
    } catch (err) {
      setNotice(err.message || 'Could not remove announcement.');
    }
  };

  const badge = (kind) => KINDS.find((k) => k.value === kind) || KINDS[0];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-lg mb-3">Announcements</h2>
        <div className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm">Post a new announcement</h3>
          {notice && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-xl px-3 py-2">
              {notice}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Kind</label>
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Title</label>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Campus Loop delayed near Katanga" />
            </div>
          </div>
          <div>
            <label className="label">Message</label>
            <textarea className="input min-h-[80px]" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Details students/drivers should know…" />
          </div>
          <div>
            <label className="label">Expires (optional)</label>
            <input className="input" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </div>
          <button className="btn-primary w-full sm:w-auto" onClick={save} disabled={busy}>
            {busy ? 'Posting…' : 'Post announcement'}
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-bold text-sm mb-2">Now showing ({announcements.length})</h3>
        <ul className="space-y-2">
          {announcements.map((a) => (
            <li key={a.id} className="card p-3 flex gap-3">
              <span className={`pill self-start uppercase !px-2 !py-0.5 text-[10px] ${badge(a.kind).badge}`}>
                {badge(a.kind).label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{a.title}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{a.message}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Posted {a.created_at ? new Date(a.created_at).toLocaleString() : 'recently'}
                  {a.expires_at ? ` · expires ${new Date(a.expires_at).toLocaleString()}` : ''}
                </p>
              </div>
              <button className="btn-danger !px-2 !py-1 !min-h-0 text-xs self-start" onClick={() => remove(a)}>
                Remove
              </button>
            </li>
          ))}
          {announcements.length === 0 && (
            <li className="card p-6 text-center text-sm text-slate-500">No active announcements.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
