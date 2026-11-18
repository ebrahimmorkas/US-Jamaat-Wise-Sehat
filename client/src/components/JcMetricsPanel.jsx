import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthError, fetchAllMetrics } from "../lib/api";
import { useRealtime } from "../hooks/useRealtime";
import { plural } from "../lib/helpers";
import { BriefcaseIcon } from "./Icons";

// The metrics JCs entered (permanent work they handle), one card per JC.
// Sahebo Dashboard: follows the Jamiat filter and updates live. Super Admin: also shows the Gmail.
export default function JcMetricsPanel({ onAuthExpired, jamiat, admin = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyWith, setOnlyWith] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchAllMetrics());
      setError("");
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      setError(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);
  // Saheb: live when a JC adds / changes / removes a metric.
  useRealtime("dashboard", "metrics:changed", load, { enabled: !admin, onReconnect: load });

  const shown = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.jcs
      .filter((u) => !jamiat || u.jamiats.includes(jamiat))
      .filter((u) => !onlyWith || u.metrics.length)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.email || "").includes(q) || u.metrics.some((m) => m.text.toLowerCase().includes(q)));
  }, [data, jamiat, query, onlyWith]);
  const metricCount = shown.reduce((n, u) => n + u.metrics.length, 0);

  return (
    <section className="panel jcm-panel" aria-label="JC Metrics">
      <div className="panel-head">
        <div>
          <h2>JC Metrics</h2>
          <p>Work each JC handles besides their Jamaats, as entered by the JC{jamiat ? ` · JCs of ${jamiat}` : ""}.</p>
        </div>
      </div>
      {error && <p className="jcm-error">{error}</p>}
      {!data ? (!error && <p className="empty-state">Loading…</p>) : (
        <>
          <div className="jcm-tools">
            <input className="input" type="search" value={query} placeholder="Search JCs or metrics…" aria-label="Search JCs or metrics" onChange={(e) => setQuery(e.target.value)} />
            <label className="check"><input type="checkbox" checked={onlyWith} onChange={(e) => setOnlyWith(e.target.checked)} /> Only JCs with metrics</label>
            <span className="muted jcm-count">{plural(shown.length, "JC")} · {plural(metricCount, "metric")}</span>
          </div>
          {!shown.length ? <p className="empty-state">{data.jcs.length ? "No JC matches." : "There are no JCs yet."}</p> : (
            <div className="jcm-grid">
              {shown.map((u) => (
                <article key={u.id} className="jcm-card">
                  <header>
                    <span className="avatar" aria-hidden="true">{u.name.slice(0, 1).toUpperCase()}</span>
                    <div className="jcm-who">
                      <b>{u.name}</b>
                      {admin && u.email && u.email !== u.name && <small>{u.email}</small>}
                      <small className="muted">{u.jamiats.length ? u.jamiats.join(", ") : "No Jamiat assigned"}</small>
                    </div>
                    <span className="jcm-badge" title="Metrics">{u.metrics.length}</span>
                  </header>
                  {u.metrics.length ? (
                    <ul>{u.metrics.map((m) => <li key={m.id}><BriefcaseIcon /><span>{m.text}</span></li>)}</ul>
                  ) : <p className="muted jcm-none">No metrics added yet.</p>}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
