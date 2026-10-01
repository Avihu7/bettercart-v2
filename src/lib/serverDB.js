/**
 * HTTP-based entity API for BetterCart.
 * Drop-in replacement for db.js (localStorage).
 * All methods have the same signatures and return Promises.
 */

// Empty string = relative URL, so /api/... resolves against the current origin.
// Vite dev proxy (vite.config.js) forwards /api/* to localhost:3001.
// Set VITE_API_URL to override (e.g. for production deployments).
const BASE_URL = import.meta.env.VITE_API_URL || '';

// Fired when the server says the session is missing/expired, so AuthContext
// can drop the user and send them to the login screen.
export const UNAUTHORIZED_EVENT = 'bettercart:unauthorized';

async function request(path, options = {}) {
  // The session cookie identifies the user; the server sets ownership (created_by)
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

export function createEntityAPI(name) {
  const base = `/api/${name}`;

  return {
    create(data) {
      return request(base, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },

    update(id, data) {
      return request(`${base}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    delete(id) {
      return request(`${base}/${id}`, { method: 'DELETE' }).then(() => undefined);
    },

    filter(filters = {}, sort = null, limit = null) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        // Keep booleans as 1/0 so the server can match SQLite integer columns
        params.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
      }
      if (sort) params.set('sort', sort);
      if (limit != null) params.set('limit', limit);
      const qs = params.toString();
      return request(`${base}${qs ? '?' + qs : ''}`);
    },

    list(sort = null, limit = null) {
      const params = new URLSearchParams();
      if (sort) params.set('sort', sort);
      if (limit != null) params.set('limit', limit);
      const qs = params.toString();
      return request(`${base}${qs ? '?' + qs : ''}`);
    },

    bulkCreate(dataArray) {
      return request(`${base}/bulk`, {
        method: 'POST',
        body: JSON.stringify(dataArray),
      });
    },
  };
}
