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

/** True when the server is unreachable or still starting (worth retrying), not for real errors. */
export const isServerStarting = (err) =>
  err && !(err instanceof AuthError) && (err.status === 0 || [502, 503, 504].includes(err.status));

const monthQuery = (month) => (month ? `?month=${encodeURIComponent(month)}` : "");
export const fetchDashboard = (month) => request("/api/dashboard" + monthQuery(month));
export const refreshDashboard = (month) => request("/api/refresh" + monthQuery(month), { method: "POST" });
export const getMe = () => request("/api/auth/me");
export const login = (username, password) => raw("/api/auth/login", { method: "POST", body: { username, password } });
export const logout = () => raw("/api/auth/logout", { method: "POST" }).catch(() => null);
export const logEvent = (action, details) =>
  request("/api/audit/event", { method: "POST", body: { action, details } }).catch(() => null);

// ---- JC portal (no sign-in) ----
export const portalOptions = () => raw("/api/portal/options");
export const portalEntry = (jamaatId, month) =>
  raw(`/api/portal/entry?jamaat=${encodeURIComponent(jamaatId)}&month=${encodeURIComponent(month)}`);
export const portalSave = (body) => raw("/api/portal/entry", { method: "POST", body });

// ---- JC users (Super Admin) ----
export const usersList = () => request("/api/users");
export const createUser = (email) => request("/api/users", { method: "POST", body: { email } });
export const updateUser = (id, body) => request(`/api/users/${id}`, { method: "PATCH", body });
export const deleteUser = (id) => request(`/api/users/${id}`, { method: "DELETE" });

// ---- Portal fields = JC form questions (Super Admin) ----
export const fieldsGet = () => request("/api/fields");
export const fieldCreate = (body) => request("/api/fields", { method: "POST", body });
export const fieldUpdate = (id, body) => request(`/api/fields/${id}`, { method: "PATCH", body });
export const fieldDelete = (id) => request(`/api/fields/${id}`, { method: "DELETE" });
export const fieldsOrder = (ids) => request("/api/fields/order", { method: "PUT", body: { ids } });
export const optionAdd = (id, body) => request(`/api/fields/${id}/options`, { method: "POST", body });
export const optionEdit = (id, oid, body) => request(`/api/fields/${id}/options/${oid}`, { method: "PATCH", body });
export const optionRemove = (id, oid) => request(`/api/fields/${id}/options/${oid}`, { method: "DELETE" });
export const optionsOrder = (id, ids) => request(`/api/fields/${id}/options/order`, { method: "PUT", body: { ids } });

// ---- Simple lists: Mauze Type (Super Admin) ----
export const listsGet = () => request("/api/settings/lists");
export const listAdd = (key, body) => request(`/api/settings/lists/${key}/values`, { method: "POST", body });
export const listEdit = (key, id, body) => request(`/api/settings/lists/${key}/values/${id}`, { method: "PATCH", body });
export const listRemove = (key, id) => request(`/api/settings/lists/${key}/values/${id}`, { method: "DELETE" });
export const listOrder = (key, ids) => request(`/api/settings/lists/${key}/order`, { method: "PUT", body: { ids } });

// ---- Masters (Super Admin) ----
export const mastersList = () => request("/api/masters");
export const createJamiat = (body) => request("/api/masters/jamiats", { method: "POST", body });
export const updateJamiat = (id, body) => request(`/api/masters/jamiats/${id}`, { method: "PATCH", body });
export const deleteJamiat = (id) => request(`/api/masters/jamiats/${id}`, { method: "DELETE" });
export const createJamaat = (body) => request("/api/masters/jamaats", { method: "POST", body });
export const updateJamaat = (id, body) => request(`/api/masters/jamaats/${id}`, { method: "PATCH", body });
export const deleteJamaat = (id) => request(`/api/masters/jamaats/${id}`, { method: "DELETE" });
