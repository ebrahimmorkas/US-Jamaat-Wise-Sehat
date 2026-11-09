import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboard, refreshDashboard } from "../lib/api";

// Loads the dashboard from the API, polls on the server's interval,
// and exposes a manual refresh that asks the server to re-read the sheet.
export function useDashboardData() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nextAt, setNextAt] = useState(null);
  const timer = useRef(null);
  const busy = useRef(false);

  const run = useCallback(async (fn) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const body = await fn();
      setPayload(body);
      setError(body.warning || "");
    } catch (err) {
      setError(err.message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
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
