import { useEffect, useMemo, useState } from 'react';
import { get } from '../../lib/api.js';
import { getSocket, connectSocket } from '../../lib/socket.js';

/**
 * useAnnouncements — the scrolling announcements banner data.
 *
 * Seeds from GET /api/announcements, then prepends any announcement:new that
 * the server pushes over the socket (admin dashboard publishes these in real
 * time). `dismiss(id)` hides an item for the session without a network call.
 *
 * Returns { announcements, dismiss } where `announcements` is already the
 * filtered (not-dismissed) list.
 */
export function useAnnouncements(online) {
  const [all, setAll] = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());

  // Initial seed (REST).
  useEffect(() => {
    if (!online) return undefined;
    let alive = true;
    get('/api/announcements')
      .then((rows) => alive && setAll(rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [online]);

  // Real-time pushes.
  useEffect(() => {
    if (!online) return undefined;
    const socket = getSocket() || connectSocket();
    const onNew = (a) => setAll((prev) => [a, ...prev.filter((x) => x.id !== a.id)]);
    socket.on('announcement:new', onNew);
    return () => socket.off('announcement:new', onNew);
  }, [online]);

  const dismiss = (id) => setDismissed((prev) => new Set(prev).add(id));

  const announcements = useMemo(
    () => all.filter((a) => !dismissed.has(a.id)),
    [all, dismissed]
  );

  return useMemo(() => ({ announcements, dismiss }), [announcements, dismiss]);
}
