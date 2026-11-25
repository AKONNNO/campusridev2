import { useAuth } from '../../lib/useAuth.jsx';
import AdminLogin from './AdminLogin.jsx';
import AdminDashboard from './AdminDashboard.jsx';

/**
 * Admin app gate (route /admin).
 *   • no token           → login screen
 *   • admin token        → dashboard
 *   • driver wandered here  → friendly note
 */
export default function AdminPage() {
  const { token, user } = useAuth();

  if (!token) return <AdminLogin />;

  if (user && user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card max-w-sm w-full p-6 text-center">
          <div className="text-4xl mb-3">🚧</div>
          <h1 className="text-lg font-bold mb-2">This is the admin dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            You are signed in as a <strong>driver</strong>. The student map and
            the driver app are separate apps in this project (<code>/</code> and
            <code> /driver</code>).
          </p>
          <button className="btn-secondary w-full" onClick={() => location.assign('/')}>
            Go to student map
          </button>
        </div>
      </div>
    );
  }

  return <AdminDashboard />;
}
