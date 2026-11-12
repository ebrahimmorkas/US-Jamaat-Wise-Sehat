import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, fetchDashboard, isServerStarting, refreshDashboard } from "../lib/api";
import { useRealtime } from "./useRealtime";

const LIVE_DEBOUNCE_MS = 400; // several JCs saving together = one reload

// Loads the dashboard for one month and keeps it live: whenever a JC saves an entry (or the
// Super Admin changes masters / fields) the server says so and the data is reloaded at once.
// `month` = "YYYY-MM" or "" for the current month. Calls onAuthError() when the session has ended.
export function useDashboardData({ month, onAuthError }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const queued = useRef(null);   // a request asked for while another was running
  const hasData = useRef(false);
  const retries = useRef(0);
  const liveTimer = useRef(null);
  const monthRef = useRef(month);
  monthRef.current = month;
  const authErrorRef = useRef(onAuthError);
  authErrorRef.current = onAuthError;
  const payloadRef = useRef(null);
  payloadRef.current = payload;

  const run = useCallback(async (fn) => {
    if (busy.current) { queued.current = fn; return; }
    busy.current = true;
    setLoading(true);
    let retry = false;
    try {
      const body = await fn(monthRef.current);
      setPayload(body);
      setError("");
      hasData.current = true;
      retries.current = 0;
    } catch (err) {
      if (err instanceof AuthError) {
        authErrorRef.current && authErrorRef.current();
      } else if (!hasData.current && isServerStarting(err) && retries.current < 24) {
        // First load: the server is unreachable or restarting. Keep trying quietly.
        retries.current += 1;
        retry = true;
        setError("Connecting to the server…");
      } else {
        setError(err.message);
      }
    } finally {
      busy.current = false;
    }
    if (queued.current) {
      const next = queued.current;
      queued.current = null;
      run(next);
      return;
    }
    setLoading(retry);
    if (retry) setTimeout(() => run(fn), 5000);
  }, []);

  useEffect(() => { run(fetchDashboard); }, [run, month]);
  useEffect(() => () => clearTimeout(liveTimer.current), []);

  const reloadSoon = useCallback(() => {
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => run(fetchDashboard), LIVE_DEBOUNCE_MS);
  }, [run]);

  useRealtime("dashboard", "dashboard:changed", (evt) => {
    const data = payloadRef.current && payloadRef.current.data;
    // An entry of another month doesn't change this view (unless that month is new to the month list).
    if (evt && evt.month && data && evt.month !== data.month && (data.months || []).some((m) => m.key === evt.month)) return;
    reloadSoon();
  }, { onReconnect: reloadSoon }); // back online: catch up on anything missed

  // "Refresh" button (also logged in the audit trail).
  const refresh = useCallback(() => run(refreshDashboard), [run]);

  return { payload, error, loading, refresh };
}
