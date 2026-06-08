'use strict';

/**
 * API client for the SPA.
 * -------------------------------------------------------------
 * Wraps fetch with: JSON handling, Bearer token + CSRF header, the
 * standard {success,data,...} envelope unwrapping, and friendly errors.
 * Token + CSRF live in localStorage so reloads keep the session (the
 * httpOnly cookie also authenticates, but the header path supports
 * non-cookie clients and CSRF).
 */
window.API = (function () {
  const TOKEN_KEY = 'dm.token';
  const CSRF_KEY = 'dm.csrf';

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
  const getCsrf = () => localStorage.getItem(CSRF_KEY);
  const setCsrf = (t) => (t ? localStorage.setItem(CSRF_KEY, t) : localStorage.removeItem(CSRF_KEY));

  async function request(method, path, body, opts = {}) {
    const headers = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!['GET', 'HEAD'].includes(method) && getCsrf()) headers['x-csrf-token'] = getCsrf();

    const init = { method, headers, credentials: 'same-origin' };
    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      init.body = body; // browser sets multipart boundary
    }

    const res = await fetch(`/api${path}`, init);

    // Binary downloads (PDF/CSV/SIF) — return the blob directly.
    const ct = res.headers.get('content-type') || '';
    if (opts.raw || (!ct.includes('application/json'))) {
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res;
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = json.message || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.code = json.code;
      err.status = res.status;
      err.details = json.details;
      throw err;
    }
    return json;
  }

  return {
    getToken, setToken, getCsrf, setCsrf,
    get: (p, opts) => request('GET', p, undefined, opts),
    post: (p, b, opts) => request('POST', p, b, opts),
    put: (p, b) => request('PUT', p, b),
    del: (p) => request('DELETE', p),

    async bootstrapCsrf() {
      try {
        const r = await request('GET', '/auth/csrf');
        if (r.data && r.data.csrfToken) setCsrf(r.data.csrfToken);
      } catch (_e) { /* non-fatal */ }
    },

    /** Trigger a browser download for a binary endpoint. */
    async download(path, filename) {
      const res = await request('GET', path, undefined, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  };
})();
