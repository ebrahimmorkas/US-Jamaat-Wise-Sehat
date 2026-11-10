import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, fetchDashboard, isServerStarting, refreshDashboard } from "../lib/api";

// Loads the dashboard for one month, polls on the server's interval, and exposes a
// manual refresh. `month` = "YYYY-MM" or "" for the current month.
// Calls onAuthError() when the session has ended.
export function useDashboardData({ month, onAuthError }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextAt, setNextAt] = useState(null);
  const timer = useRef(null);
  const busy = useRef(false);
  const queued = useRef(null);   // a request asked for while another was running
  const hasData = useRef(false);
  const retries = useRef(0);
  const monthRef = useRef(month);
  monthRef.current = month;
  const authErrorRef = useRef(onAuthError);
  authErrorRef.current = onAuthError;

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

  const intervalSecs = payload ? payload.config.refreshIntervalSeconds : 0;

  const schedule = useCallback(
    (secs) => {
      clearInterval(timer.current);
      if (!secs) { setNextAt(null); return; }
      setNextAt(Date.now() + secs * 1000);
      timer.current = setInterval(() => {
        setNextAt(Date.now() + secs * 1000);
        run(fetchDashboard);
      }, secs * 1000);
    },
    [run]
  );

  useEffect(() => { run(fetchDashboard); }, [run, month]);
  useEffect(() => { schedule(intervalSecs); return () => clearInterval(timer.current); }, [intervalSecs, schedule]);

  const refresh = useCallback(() => {
    run(refreshDashboard);
    schedule(intervalSecs); // restart the countdown
  }, [run, schedule, intervalSecs]);

  return { payload, error, loading, nextAt, intervalSecs, refresh };
}
