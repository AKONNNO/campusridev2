import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/useAuth.jsx';
import StudentPage from './pages/student/StudentPage.jsx';
import DriverPage from './pages/driver/DriverPage.jsx';
import AdminPage from './pages/admin/AdminPage.jsx';

/**
 * App router.
 *   /           → student app (no login) — live map, stops, ETAs, planner
 *   /driver/*   → driver mobile app (login with phone + PIN)
 *   /admin/*    → admin dashboard (login with phone + PIN)
 */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<StudentPage />} />
        <Route path="/driver/*" element={<DriverPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}


