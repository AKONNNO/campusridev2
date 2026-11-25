import { useState } from 'react';
import { useAuth } from '../../lib/useAuth.jsx';
import { connectSocket } from '../../lib/socket.js';

/**
 * Driver sign-in — phone + PIN (the same endpoint as admin; role decides
 * the app you land in). Bcrypt hashes stay on the server; we only keep a JWT.
 */
export default function DriverLogin() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await login(phone.trim(), pin);
      connectSocket(data.token);
    } catch (err) {
      setError(err.message || 'Sign-in failed. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-night to-night-900 p-5">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500 text-night text-3xl shadow-lg mb-3">
            🚌
          </div>
          <h1 className="text-xl font-bold text-white">KNUST Bus Tracker</h1>
          <p className="text-sm text-slate-300 mt-1">Driver sign in</p>
        </div>

        <form onSubmit={submit} className="card p-5 space-y-4">
          <div>
            <label className="label" htmlFor="phone">Phone number</label>
            <input
              id="phone"
              className="input"
              type="tel"
              inputMode="numeric"
              autoComplete="username"
              placeholder="e.g. 0241234002"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="pin">PIN</label>
            <input
              id="pin"
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="Your 4+ digit PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              minLength={4}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-[11px] leading-relaxed text-slate-400 text-center">
            Demo driver: <strong>0241234002</strong> / PIN <strong>1234</strong>
          </p>
        </form>
      </div>
    </div>
  );
}
