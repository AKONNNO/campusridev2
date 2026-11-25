import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { post } from './api.js';
import { getToken, setToken, clearToken, getStoredUser, setStoredUser } from './token.js';
import { disconnectSocket } from './socket.js';

/**
 * Auth context — shared by the driver and admin apps.
 *   { user, token, login(phone, pin), logout(), isDriver, isAdmin }
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());
  const [user, setUserState] = useState(() => getStoredUser());

  const login = useCallback(async (phone, pin) => {
    const data = await post('/api/auth/login', { phone, pin });
    setToken(data.token);
    setStoredUser(data.user);
    setTokenState(data.token);
    setUserState(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    disconnectSocket();
    setTokenState(null);
    setUserState(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      login,
      logout,
      isDriver: user?.role === 'driver',
      isAdmin: user?.role === 'admin',
    }),
    [user, token, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
