async function request(path, options) {
  const res = await fetch(path, { headers: { Accept: "application/json" }, ...options });
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
