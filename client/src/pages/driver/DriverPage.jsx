import { useAuth } from '../../lib/useAuth.jsx';
import DriverLogin from './DriverLogin.jsx';
import DriverDashboard from './DriverDashboard.jsx';

/**
 * Driver app gate.
 *   • no token        → login screen
 *   • driver token    → dashboard (trip control + GPS sharing)
 *   • non-driver token (admin wandered here) → friendly redirect message
 */
export default function DriverPage() {
  const { token, user } = useAuth();

  if (!token) return <DriverLogin />;

  if (user && user.role !== 'driver') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-sm w-full p-6 text-center">
          <div className="text-4xl mb-3">🚧</div>
          <h1 className="text-lg font-bold mb-2">This is the driver app</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            You are signed in as an <strong>admin</strong>. The admin dashboard
            and the student map are separate apps in this project ({' '}
            <code>/admin</code> and <code>/</code>).
          </p>
          <button className="btn-secondary w-full" onClick={() => localStorage.clear() && location.assign('/')}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <DriverDashboard />;
}
