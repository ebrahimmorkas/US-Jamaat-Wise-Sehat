// Address of the API. Empty in development (Vite proxies /api to localhost:5000);
// on Vercel set VITE_API_URL to the Render URL, e.g. https://xyz.onrender.com
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

async function request(path, options) {
  const res = await fetch(API_BASE + path, { headers: { Accept: "application/json" }, ...options });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new Error((body && body.error) || `Server error (${res.status})`);
  return body;
}

export const fetchDashboard = () => request("/api/dashboard");
export const refreshDashboard = () => request("/api/refresh", { method: "POST" });
