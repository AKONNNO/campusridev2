import { useCallback, useEffect, useState } from 'react';
import { get, del } from '../../../lib/api.js';

/**
 * FeedbackTab — review student feedback/report submissions (newest first) and
 * remove ones that have been actioned. No per-item editing — treat + delete.
 */
export default function FeedbackTab() {
  const [items, setItems] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    get('/api/admin/feedback')
      .then(setItems)
      .catch((err) => setNotice(err.message || 'Could not load feedback.'));
  }, []);

  useEffect(load, [load]);

  const remove = async (f) => {
    if (!window.confirm('Remove this feedback? This cannot be undone.')) return;
    setNotice(null);
    try {
      await del(`/api/admin/feedback/${f.id}`);
      setItems((prev) => (prev || []).filter((x) => x.id !== f.id));
    } catch (err) {
      setNotice(err.message || 'Could not remove feedback.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Student feedback ({items?.length ?? 0})</h2>
        <button className="btn-secondary !py-1 !px-2 !min-h-0 text-xs" onClick={load}>
          Refresh
        </button>
      </div>

      {notice && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}

      {!items && (
        <div className="card p-6 text-center text-sm text-slate-500 animate-pulse">
          Loading feedback…
        </div>
      )}

      {items && items.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">
          No feedback yet. Submissions from the student app's Feedback tab appear here.
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="card divide-y divide-slate-100 dark:divide-night-700 overflow-hidden">
          {items.map((f) => (
            <li key={f.id} className="p-3 space-y-1">
              <p className="text-sm whitespace-pre-wrap">{f.message}</p>
              <p className="text-xs text-slate-400">
                {f.stopName ? `📍 ${f.stopName} · ` : ''}
                {f.busNumber ? `🚌 ${f.busNumber} · ` : ''}
                {f.contact ? `✉️ ${f.contact} · ` : ''}
                {f.createdAt ? new Date(f.createdAt).toLocaleString() : ''}
              </p>
              <div className="flex justify-end">
                <button className="btn-danger !px-2 !py-1 !min-h-0 text-xs" onClick={() => remove(f)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
