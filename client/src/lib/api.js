import { getToken } from './token.js';

/**
 * Small fetch wrapper.
 *  • attaches the JWT when present
 *  • JSON in/out
 *  • throws an Error carrying the server's message + status on non-2xx
 *  • `apiBase` defaults to '' so dev uses the Vite proxy (same origin)
 */
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const authToken = token ?? getToken();
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null; // empty body
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

/** Convenience helpers. */
export const get = (p, opts) => api(p, { ...opts, method: 'GET' });
export const post = (p, body, opts) => api(p, { ...opts, method: 'POST', body });
export const put = (p, body, opts) => api(p, { ...opts, method: 'PUT', body });
export const patch = (p, body, opts) => api(p, { ...opts, method: 'PATCH', body });
export const del = (p, opts) => api(p, { ...opts, method: 'DELETE' });
