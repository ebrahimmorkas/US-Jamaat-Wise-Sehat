// All calls go to /api on the same website (Vercel forwards them to the API server),
// so the HttpOnly login cookies are first-party and work in every browser.
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
/** Thrown when the user must sign in again. */
export class AuthError extends ApiError {}

// file: a File sent as the request body (Excel upload); blob: the answer is a file ({ blob, name }).
// headers: extra request headers. onProgress(0..1): upload progress (uses XMLHttpRequest).
async function raw(path, { method = "GET", body, file, blob, headers: extra, onProgress } = {}) {
  if (file && onProgress) return rawWithProgress(path, { method, file, extra, onProgress });
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: "include",
      headers: {
        Accept: blob ? "*/*" : "application/json",
        "X-Requested-With": "fetch",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(file ? { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name || "") } : {}),
        ...(extra || {}),
      },
      body: file || (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your internet connection.", 0, "NETWORK");
  }
  if (res.status === 204) return null;
  if (blob && res.ok) {
    const cd = res.headers.get("content-disposition") || "";
    const m = /filename="([^"]+)"/.exec(cd);
    return { blob: await res.blob(), name: m ? m[1] : "download" };
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new ApiError((data && data.error) || `Server error (${res.status})`, res.status, data && data.code);
    err.data = data; // e.g. a form's { problems } or { startAt }
    // A server error (already saved in the error log) -> Error page with its reference.
    if (res.status === 500 && data && data.code === "SERVER_ERROR") {
      err.ref = data.ref;
      window.dispatchEvent(new CustomEvent("app:error", { detail: { ref: data.ref, source: "server", path } }));
    }
    // The user's role may not do this (already logged by the server) -> Access denied page.
    if (res.status === 403 && data && data.code === "FORBIDDEN") {
      window.dispatchEvent(new CustomEvent("app:denied", { detail: { path } }));
    }
    throw err;
  }
  return data;
}

// Upload with a progress bar (fetch can't report upload progress).
function rawWithProgress(path, { method, file, extra, onProgress }) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, API_BASE + path);
    x.withCredentials = true;
    x.setRequestHeader("Accept", "application/json");
    x.setRequestHeader("X-Requested-With", "fetch");
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.setRequestHeader("X-File-Name", encodeURIComponent(file.name || ""));
    for (const [k, v] of Object.entries(extra || {})) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onerror = () => reject(new ApiError("Can't reach the server. Check your internet connection.", 0, "NETWORK"));
    x.onload = () => {
      let data = null;
      try { data = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) return resolve(data);
      reject(new ApiError((data && data.error) || (x.status === 413 ? "The file is too large." : `Server error (${x.status})`), x.status, data && data.code));
    };
    x.send(file);
  });
}

/** Saves a website crash in the error log; resolves to its reference (or "" if it couldn't be sent). */
export const reportClientError = (info) =>
  raw("/api/logs/client-error", { method: "POST", body: { page: window.location.pathname + window.location.search, ...info } })
    .then((r) => (r && r.ref) || "")
    .catch(() => "");
export const reportAccessDenied = (page) => raw("/api/logs/access-denied", { method: "POST", body: { page } }).catch(() => null);

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
// Who is signed in (renews the session if needed). Signed out -> AuthError, without a 401 in the console.
export const getMe = () =>
  raw("/api/auth/session").then((r) => {
    if (!r || !r.user) throw new AuthError("Please sign in.", 401, "SIGNED_OUT");
    return r;
  });
export const authConfig = () => raw("/api/auth/config");
export const googleLogin = (credential) => raw("/api/auth/google", { method: "POST", body: { credential } });
export const devLogin = (email) => raw("/api/auth/dev-login", { method: "POST", body: { email } });
export const logout = () => raw("/api/auth/logout", { method: "POST" }).catch(() => null);
export const realtimeTicket = () => request("/api/realtime/ticket", { method: "POST" });
// Stats images (Super Admin uploads; every portal sees them).
export const fetchStats = () => request("/api/stats");
export const uploadStat = (file, title, jamiat) => request(`/api/stats?jamiat=${encodeURIComponent(jamiat)}&title=${encodeURIComponent(title || "")}`, { method: "POST", file });
export const deleteStat = (id) => request(`/api/stats/${id}`, { method: "DELETE" });

// JC Metrics (permanent work a JC handles).
export const fetchMyMetrics = () => request("/api/metrics/mine");
export const addMetric = (text) => request("/api/metrics", { method: "POST", body: { text } });
export const updateMetric = (id, text) => request(`/api/metrics/${id}`, { method: "PATCH", body: { text } });
export const deleteMetric = (id) => request(`/api/metrics/${id}`, { method: "DELETE" });
export const fetchAllMetrics = () => request("/api/metrics");
export const setJcRating = (userId, stars) => request(`/api/metrics/rating/${userId}`, { method: "PUT", body: { stars } });

// Data tab (Excel data per Jamaat).
export const fetchData = () => request("/api/data");
export const setDataCell = (id, column, value, version) => request(`/api/data/rows/${id}`, { method: "PATCH", body: { column, value, version } });
export const fetchDataAdmin = () => request("/api/data/admin");
const dataOpts = (o) => `?o=${encodeURIComponent(JSON.stringify(o || {}))}`;
export const previewData = (file, opts) => request("/api/data/preview" + dataOpts(opts), { method: "POST", file });
export const uploadData = (file, opts) => request("/api/data/upload" + dataOpts(opts), { method: "POST", file });
export const saveDataChoices = (choices) => request("/api/data/choices", { method: "PUT", body: { choices } });
export const clearData = () => request("/api/data/clear", { method: "POST", body: { confirm: "CLEAR" } });
/** Downloads the Data Excel file (a JC gets their Jamaats, the Super Admin everything). */
export async function downloadData() {
  const { blob, name } = await request("/api/data/download", { blob: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// The assistant: { blocks, intent, source }. history = [{ q, intent }] of earlier questions.
export const chatAsk = (message, history) => request("/api/chat", { method: "POST", body: { message, history } });
export const logEvent = (action, details) =>
  request("/api/audit/event", { method: "POST", body: { action, details } }).catch(() => null);

// ---- JC portal (signed-in JCs) ----
export const portalOptions = () => request("/api/portal/options");
export const portalSummary = (month) => request("/api/portal/summary" + monthQuery(month));
// Comment text is fetched only when someone opens "Comments" (the server logs it).
export const portalComments = (month) => request("/api/portal/comments" + monthQuery(month));
export const dashboardComments = (month) => request("/api/dashboard/comments" + monthQuery(month));
export const portalEntry = (jamaatId, month) =>
  request(`/api/portal/entry?jamaat=${encodeURIComponent(jamaatId)}&month=${encodeURIComponent(month)}`);
export const portalSave = (body) => request("/api/portal/entry", { method: "POST", body });

// ---- Logs (Super Admin) ----
const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};
export const auditList = (params) => request("/api/audit" + qs(params));
export const errorList = (params) => request("/api/logs/errors" + qs(params));
// Permanently delete logs. { kind, range, days, from, to, dryRun, confirm }
export const purgeLogs = (body) => request("/api/logs/purge", { method: "POST", body });

// ---- JC users (Super Admin) ----
export const usersList = () => request("/api/users");
export const createUser = (body) => request("/api/users", { method: "POST", body });
export const allAccessCount = (type, id) => request(`/api/users/all-access?type=${type}&id=${encodeURIComponent(id)}`);
export const grantAllAccess = (type, id) => request("/api/users/all-access", { method: "POST", body: { type, id } });
export const updateUser = (id, body) => request(`/api/users/${id}`, { method: "PATCH", body });
export const deleteUser = (id) => request(`/api/users/${id}`, { method: "DELETE" });
export const restoreUser = (id) => request(`/api/users/${id}/restore`, { method: "POST" });

// ---- Portal fields = JC form questions (Super Admin) ----
export const fieldsGet = () => request("/api/fields");
export const fieldCreate = (body) => request("/api/fields", { method: "POST", body });
export const fieldUpdate = (id, body) => request(`/api/fields/${id}`, { method: "PATCH", body });
export const fieldDelete = (id) => request(`/api/fields/${id}`, { method: "DELETE" });
export const fieldRestore = (id) => request(`/api/fields/${id}/restore`, { method: "POST" });
export const optionRestore = (id, oid) => request(`/api/fields/${id}/options/${oid}/restore`, { method: "POST" });
export const fieldsOrder = (ids) => request("/api/fields/order", { method: "PUT", body: { ids } });
export const optionAdd = (id, body) => request(`/api/fields/${id}/options`, { method: "POST", body });
export const optionEdit = (id, oid, body) => request(`/api/fields/${id}/options/${oid}`, { method: "PATCH", body });
export const optionRemove = (id, oid) => request(`/api/fields/${id}/options/${oid}`, { method: "DELETE" });
export const optionsOrder = (id, ids) => request(`/api/fields/${id}/options/order`, { method: "PUT", body: { ids } });
// monthly activities of a question
export const activitiesGet = (id, month) => request(`/api/fields/${id}/activities${month ? `?month=${encodeURIComponent(month)}` : ""}`);
export const activityAdd = (id, month, name) => request(`/api/fields/${id}/activities`, { method: "POST", body: { month, name } });
export const activityEdit = (id, aid, name) => request(`/api/fields/${id}/activities/${aid}`, { method: "PATCH", body: { name } });
export const activityRemove = (id, aid) => request(`/api/fields/${id}/activities/${aid}`, { method: "DELETE" });
export const activityRestore = (id, aid) => request(`/api/fields/${id}/activities/${aid}/restore`, { method: "POST" });
export const activitiesOrder = (id, month, ids) => request(`/api/fields/${id}/activities/order`, { method: "PUT", body: { month, ids } });
export const activitiesCopy = (id, month) => request(`/api/fields/${id}/activities/copy`, { method: "POST", body: { month } });

// ---- Simple lists: Mauze Type (Super Admin) ----
export const listsGet = () => request("/api/settings/lists");
export const listAdd = (key, body) => request(`/api/settings/lists/${key}/values`, { method: "POST", body });
export const listEdit = (key, id, body) => request(`/api/settings/lists/${key}/values/${id}`, { method: "PATCH", body });
export const listRemove = (key, id) => request(`/api/settings/lists/${key}/values/${id}`, { method: "DELETE" });
export const listRestore = (key, id) => request(`/api/settings/lists/${key}/values/${id}/restore`, { method: "POST" });
export const listOrder = (key, ids) => request(`/api/settings/lists/${key}/order`, { method: "PUT", body: { ids } });

// ---- Masters (Super Admin) ----
export const mastersList = () => request("/api/masters");
export const createJamiat = (body) => request("/api/masters/jamiats", { method: "POST", body });
export const updateJamiat = (id, body) => request(`/api/masters/jamiats/${id}`, { method: "PATCH", body });
export const deleteJamiat = (id) => request(`/api/masters/jamiats/${id}`, { method: "DELETE" });
export const restoreJamiat = (id) => request(`/api/masters/jamiats/${id}/restore`, { method: "POST" });
export const createJamaat = (body) => request("/api/masters/jamaats", { method: "POST", body });
export const updateJamaat = (id, body) => request(`/api/masters/jamaats/${id}`, { method: "PATCH", body });
export const deleteJamaat = (id) => request(`/api/masters/jamaats/${id}`, { method: "DELETE" });
export const restoreJamaat = (id) => request(`/api/masters/jamaats/${id}/restore`, { method: "POST" });

// ---- Forms (Super Admin builds; JCs share links; Jamaat Coordinators fill) ----
export const formsList = () => request("/api/forms");
export const formGet = (id) => request(`/api/forms/${id}`);
export const formCreate = (body) => request("/api/forms", { method: "POST", body });
export const formSave = (id, body) => request(`/api/forms/${id}`, { method: "PUT", body });
export const formStatus = (id, status) => request(`/api/forms/${id}/status`, { method: "POST", body: { status } });
export const formTopImage = (id, file) => request(`/api/forms/${id}/top-image`, { method: "POST", file });
export const formTopImageRemove = (id) => request(`/api/forms/${id}/top-image`, { method: "DELETE" });
export const formLinkFor = (id, email) => request(`/api/forms/${id}/link?email=${encodeURIComponent(email)}`);
export const formClearTests = (id) => request(`/api/forms/${id}/test-responses`, { method: "DELETE" });
export const formDelete = (id) => request(`/api/forms/${id}`, { method: "DELETE" });
export const formRestore = (id) => request(`/api/forms/${id}/restore`, { method: "POST" });
export async function formLinksExcel(id) {
  const { blob, name } = await request(`/api/forms/${id}/links.xlsx`, { blob: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const jcFormLinks = () => request("/api/forms/jc-links");

// Responses (Super Admin, Saheb, JC — a JC sees only their own Jamaats). Forms are addressed by their code.
const rq = (p) => new URLSearchParams(Object.entries(p || {}).filter(([, v]) => v != null && v !== "")).toString();
export const resultsList = () => request("/api/form-results");
export const resultsGet = (code, p) => request(`/api/form-results/${encodeURIComponent(code)}?${rq(p)}`);
export async function resultsExcel(code, p) {
  let tz = "UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* old browser */ }
  const { blob, name } = await request(`/api/form-results/${encodeURIComponent(code)}/excel?${rq({ ...p, tz })}`, { blob: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const resultsStatus = (code, p) => request(`/api/form-results/${encodeURIComponent(code)}/status?${rq(p)}`);
export const remindInfo = (code, p) => request(`/api/form-results/${encodeURIComponent(code)}/remind?${rq(p)}`);
export const remindSend = (code, body) => request(`/api/form-results/${encodeURIComponent(code)}/remind`, { method: "POST", body });
export async function resultsStatusExcel(code, p) {
  let tz = "UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* old browser */ }
  const { blob, name } = await request(`/api/form-results/${encodeURIComponent(code)}/status/excel?${rq({ ...p, tz })}`, { blob: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const myForms = () => request("/api/forms/mine");
// Jamaat Coordinator portal (only their own data).
export const coordResponses = () => request("/api/coordinator/responses");
export const coordNotifications = () => request("/api/coordinator/notifications");
export const coordUnread = () => request("/api/coordinator/unread");
export const coordMarkRead = (id) => request("/api/coordinator/notifications/read", { method: "POST", body: id ? { id } : {} });
export const coordProfile = () => request("/api/coordinator/profile");

// Filling (works signed in or not; `t` = personal link token, editKey = this browser's key for "anyone" forms).
// `forJ` = a JC filling for one of their Jamaats (sealed Jamaat, on behalf of its Coordinator).
const tq = (t, forJ) => [t ? `t=${encodeURIComponent(t)}` : "", forJ ? `for=${encodeURIComponent(forJ)}` : ""].filter(Boolean).join("&");
export const fillGet = (id, t, editKey, forJ) => raw(`/api/f/${id}${tq(t, forJ) ? `?${tq(t, forJ)}` : ""}`, { headers: editKey ? { "X-Edit-Key": editKey } : undefined });
export const fillUpload = (id, field, t, file, onProgress, forJ) =>
  raw(`/api/f/${id}/upload?field=${encodeURIComponent(field)}${tq(t, forJ) ? `&${tq(t, forJ)}` : ""}`, { method: "POST", file, onProgress });
export const fillSubmit = (id, body) => raw(`/api/f/${id}/submit`, { method: "POST", body });

// ---- "Send email" (Super Admin, Saheb) + the email provider (Super Admin) ----
export const emailPeople = () => raw("/api/emails/people");
export const emailPreview = (to) => raw("/api/emails/preview", { method: "POST", body: { to } });
export const emailAttach = (file, onProgress) =>
  raw("/api/emails/files", { method: "POST", file, onProgress, headers: { "X-File-Type": file.type || "application/octet-stream" } });
export const emailDropFile = (id) => raw(`/api/emails/files/${id}`, { method: "DELETE" });
export const emailSend = (body) => raw("/api/emails", { method: "POST", body });
export const emailList = (kind) => raw(`/api/emails${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`);
export const emailGet = (id) => raw(`/api/emails/${id}`);
export const emailCancel = (id) => raw(`/api/emails/${id}/cancel`, { method: "POST" });
export const emailRetry = (id) => raw(`/api/emails/${id}/retry`, { method: "POST" });
export const emailProviders = () => raw("/api/emails/settings/providers");
export const emailSetProvider = (provider) => raw("/api/emails/settings/providers", { method: "PUT", body: { provider } });
// Image storage (Super Admin): where new uploads are saved.
export const storageSettings = () => raw("/api/storage/settings");
export const storageSet = (provider) => raw("/api/storage/settings", { method: "PUT", body: { provider } });
export const storageTest = (provider) => raw("/api/storage/test", { method: "POST", body: { provider } });
export const emailTest = (provider) => raw("/api/emails/settings/test", { method: "POST", body: { provider } });

// Email templates, variables, images / documents inside emails, preview
export const emailVariables = () => raw("/api/emails/variables");
export const emailForms = () => raw("/api/emails/forms");
export const emailPublic = (file, onProgress) =>
  raw("/api/emails/public", { method: "POST", file, onProgress, headers: { "X-File-Type": file.type || "application/octet-stream" } });
export const emailRender = (body) => raw("/api/emails/render", { method: "POST", body });
export const templateList = (deleted) => raw(`/api/emails/templates${deleted ? "?deleted=1" : ""}`);
export const templateGet = (id) => raw(`/api/emails/templates/${id}`);
export const templateCreate = (body) => raw("/api/emails/templates", { method: "POST", body });
export const templateSave = (id, body) => raw(`/api/emails/templates/${id}`, { method: "PUT", body });
export const templateDelete = (id) => raw(`/api/emails/templates/${id}`, { method: "DELETE" });
export const templateRestore = (id) => raw(`/api/emails/templates/${id}/restore`, { method: "POST" });

// Reports: formats (Super Admin), Media's photo choice, generating (Super Admin, Saheb, JC, Media).
async function saveBlob(path) {
  const { blob, name } = await request(path, { blob: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const enc = encodeURIComponent;
export const reportFormats = () => request("/api/reports/formats");
export const reportFormatAdd = (name, file, onProgress) => request(`/api/reports/formats?name=${enc(name)}`, { method: "POST", file, onProgress });
export const reportFormatSave = (id, body) => request(`/api/reports/formats/${enc(id)}`, { method: "PUT", body });
export const reportFormatReplace = (id, file, onProgress) => request(`/api/reports/formats/${enc(id)}/file`, { method: "PUT", file, onProgress });
export const reportFormatDelete = (id) => request(`/api/reports/formats/${enc(id)}`, { method: "DELETE" });
export const reportFormatFile = (id) => saveBlob(`/api/reports/formats/${enc(id)}/file`);
export const reportFormatSample = (id, w, h) => saveBlob(`/api/reports/formats/${enc(id)}/sample?w=${enc(w || "")}&h=${enc(h || "")}`);
export const reportForms = () => request("/api/reports/forms");
export const reportPhotos = (code) => request(`/api/reports/forms/${enc(code)}/photos`);
export const reportSetCount = (code, count) => request(`/api/reports/forms/${enc(code)}/count`, { method: "PUT", body: { count } });
export const reportPick = (code, jamaat, photos) => request(`/api/reports/forms/${enc(code)}/picks`, { method: "PUT", body: { jamaat, photos } });
export const reportPhotoFile = (id) => saveBlob(`/api/reports/photos/${enc(id)}/file`);
export const reportGenerate = (form, format) => request("/api/reports/generate", { method: "POST", body: { form, format } });
export const reportJob = (id) => request(`/api/reports/jobs/${enc(id)}`);
export const reportJobFile = (id, which) => saveBlob(`/api/reports/jobs/${enc(id)}/${which}`);
