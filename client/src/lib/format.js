/** Human-friendly formatting helpers for ETA / timestamps / headings. */

/** "now", "2 min", "1h 05m" */
export function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds <= 30) return 'now';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "2 min" for alerts (minutes given directly). */
export function formatMinutes(mins) {
  return mins === 1 ? '1 min' : `${mins} mins`;
}

/** Clock time, e.g. "14:03". */
export function clockTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Relative "last updated" text, e.g. "just now", "42s ago", "3m ago". */
export function timeAgo(input) {
  if (!input) return '—';
  const t = typeof input === 'number' ? input : new Date(input).getTime();
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

/** Compass name for a heading in degrees. */
export function directionName(deg) {
  if (!Number.isFinite(deg)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export const STATUS_LABELS = {
  on_trip: 'On route',
  break: 'Break',
  breakdown: 'Breakdown',
  full: 'Full',
  offline: 'Offline',
  idle: 'Idle',
};

export const STATUS_COLORS = {
  on_trip: 'bg-emerald-500 text-white',
  break: 'bg-amber-400 text-night-900',
  breakdown: 'bg-red-600 text-white',
  full: 'bg-violet-500 text-white',
  offline: 'bg-slate-400 text-white',
  idle: 'bg-slate-300 text-slate-700',
};
