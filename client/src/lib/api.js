// All calls go to /api on the same website (Vercel forwards them to the API server),
// so the HttpOnly login cookies are first-party and work in every browser.
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
/** Thrown when the user must sign in again. */
export class AuthError extends ApiError {}

async function raw(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "fetch",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your internet connection.", 0, "NETWORK");
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Server error (${res.status})`, res.status, data && data.code);
  return data;
}

// One refresh at a time, shared by all requests that hit an expired access token.
let refreshing = null;
const refreshSession = () => {
  if (!refreshing) refreshing = raw("/api/auth/refresh", { method: "POST" }).finally(() => { refreshing = null; });
  return refreshing;
};

async function request(path, options) {
  try {
    return await raw(path, options);
  } catch (err) {
    if (err.status !== 401) throw err;
  }
  try {
    await refreshSession();
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw new AuthError("Please sign in.", 401, "SIGNED_OUT");
    throw err;
  }
  try {
    return await raw(path, options);
  } catch (err) {
    if (err.status === 401) throw new AuthError("Please sign in.", 401, "SIGNED_OUT");
    throw err;
  }
}

export const fetchDashboard = () => request("/api/dashboard");
export const refreshDashboard = () => request("/api/refresh", { method: "POST" });
export const getMe = () => request("/api/auth/me");
export const login = (username, password) => raw("/api/auth/login", { method: "POST", body: { username, password } });
export const logout = () => raw("/api/auth/logout", { method: "POST" }).catch(() => null);
export const logEvent = (action, details) =>
  request("/api/audit/event", { method: "POST", body: { action, details } }).catch(() => null);
