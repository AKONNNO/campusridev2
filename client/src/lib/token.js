/**
 * Tiny localStorage-backed token + user store.
 * Persisting the JWT means drivers don't re-enter their PIN on every reload.
 */
const TOKEN_KEY = 'knust_bus_token';
const USER_KEY = 'knust_bus_user';

export function getToken() {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
