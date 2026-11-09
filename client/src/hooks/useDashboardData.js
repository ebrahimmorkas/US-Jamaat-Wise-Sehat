import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, fetchDashboard, refreshDashboard } from "../lib/api";

// Loads the dashboard from the API, polls on the server's interval, and exposes a
// manual refresh. Calls onAuthError() when the session has ended.
export function useDashboardData({ onAuthError }) {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextAt, setNextAt] = useState(null);
  const timer = useRef(null);
  const busy = useRef(false);
  const hasData = useRef(false);
  const retries = useRef(0);
  const authErrorRef = useRef(onAuthError);
  authErrorRef.current = onAuthError;

  const run = useCallback(async (fn) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    let retry = false;
    try {
      const body = await fn();
      setPayload(body);
      setError(body.warning || "");
      hasData.current = true;
      retries.current = 0;
    } catch (err) {
      if (err instanceof AuthError) {
        authErrorRef.current && authErrorRef.current();
      } else if (!hasData.current && retries.current < 24) {
        // First load failed: the hosted server may be waking up. Keep trying.
        retries.current += 1;
        retry = true;
        setError("Starting the server… this can take up to a minute after a quiet period.");
      } else {
        setError(err.message);
      }
    } finally {
      busy.current = false;
      setLoading(retry);
    }
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

  useEffect(() => { run(fetchDashboard); }, [run]);
  useEffect(() => { schedule(intervalSecs); return () => clearInterval(timer.current); }, [intervalSecs, schedule]);

  const refresh = useCallback(() => {
    run(refreshDashboard);
    schedule(intervalSecs); // restart the countdown
  }, [run, schedule, intervalSecs]);

  return { payload, error, loading, nextAt, intervalSecs, refresh };
}
