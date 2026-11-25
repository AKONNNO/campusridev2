import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/useAuth.jsx';
import { useAdminData } from './useAdminData.js';
import OverviewTab from './tabs/OverviewTab.jsx';
import BusesTab from './tabs/BusesTab.jsx';
import RoutesTab from './tabs/RoutesTab.jsx';
import StopsTab from './tabs/StopsTab.jsx';
import DriversTab from './tabs/DriversTab.jsx';
import AnnouncementsTab from './tabs/AnnouncementsTab.jsx';
import TripsTab from './tabs/TripsTab.jsx';
import ReportsTab from './tabs/ReportsTab.jsx';
import FeedbackTab from './tabs/FeedbackTab.jsx';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '🗺️' },
  { id: 'buses', label: 'Buses', icon: '🚌' },
  { id: 'routes', label: 'Routes', icon: '🛣️' },
  { id: 'stops', label: 'Stops', icon: '📍' },
  { id: 'drivers', label: 'Drivers', icon: '👤' },
  { id: 'announcements', label: 'Announcements', icon: '📢' },
  { id: 'trips', label: 'Trips', icon: '🕒' },
  { id: 'reports', label: 'Reports', icon: '📊' },
  { id: 'feedback', label: 'Feedback', icon: '💬' },
];

/**
 * AdminDashboard — navigation shell over the nine admin tools. Loads the
 * shared CRUD collections once (useAdminData) and hands them to each tab,
 * which reload() after any mutation so the server's route cache stays fresh.
 */
export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('overview');
  const data = useAdminData();

  if (data.error && data.buses.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-sm w-full p-6 text-center">
          <div className="text-3xl mb-2">⚠️</div>
          <p className="font-semibold">Could not load admin data.</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">{data.error}</p>
          <button className="btn-secondary w-full" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-night pb-12">
      <header className="sticky top-0 z-20 bg-night text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="font-bold truncate">🛠️ KNUST Bus Tracker Admin</h1>
            <p className="text-xs text-slate-300 truncate">Signed in as {user?.name}</p>
          </div>
          <Link to="/" className="btn-secondary !px-3 !py-1.5 !min-h-0 text-sm">
            Student map
          </Link>
          <button onClick={logout} className="btn-secondary !px-3 !py-1.5 !min-h-0 text-sm">
            Sign out
          </button>
        </div>
      </header>

      <nav className="sticky top-[52px] z-10 bg-white/90 dark:bg-night-800/90 backdrop-blur border-b border-slate-200 dark:border-night-700 overflow-x-auto">
        <div className="max-w-5xl mx-auto px-2 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 ${
                tab === t.id
                  ? 'border-brand-500 text-brand-600 dark:text-brand-300'
                  : 'border-transparent text-slate-500 dark:text-slate-400'
              }`}
              onClick={() => setTab(t.id)}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {tab === 'overview' && <OverviewTab routes={data.routes} stops={data.stops} />}
        {tab === 'buses' && <BusesTab data={data} />}
        {tab === 'routes' && <RoutesTab data={data} />}
        {tab === 'stops' && <StopsTab data={data} />}
        {tab === 'drivers' && <DriversTab data={data} />}
        {tab === 'announcements' && <AnnouncementsTab data={data} />}
        {tab === 'trips' && <TripsTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'feedback' && <FeedbackTab />}
      </main>
    </div>
  );
}
