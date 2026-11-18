import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthError, fetchAllMetrics, setJcRating } from "../lib/api";
import { useRealtime } from "../hooks/useRealtime";
import { plural } from "../lib/helpers";
import { Link } from "../lib/router";
import { BriefcaseIcon } from "./Icons";

// The metrics JCs entered (permanent work they handle), one card per JC.
// Sahebo Dashboard: follows the Jamiat filter and updates live. Super Admin: also shows the Gmail.
// summary: one slim line at the top of the Sahebo Dashboard (counts + "View all" -> the JC Metrics tab).
// Without a `jamiat` prop the page has its own Jamiat filter.
export default function JcMetricsPanel({ onAuthExpired, jamiat: outerJamiat, admin = false, summary = false, heading = true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyWith, setOnlyWith] = useState(false);
  const [ownJamiat, setOwnJamiat] = useState("");
  const [sort, setSort] = useState("most"); // most | fewest | best | worst
  const [rating, setRating] = useState(""); // JC id being saved
  const [rateError, setRateError] = useState("");
  const jamiat = outerJamiat === undefined ? ownJamiat : outerJamiat;

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
      .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.email || "").includes(q) || u.metrics.some((m) => m.text.toLowerCase().includes(q)))
      .sort(SORTS[sort].by);
  }, [data, jamiat, query, onlyWith, sort]);

  // Super Admin: click a star to rate (clicking the current rating again clears it).
  const rate = async (u, n) => {
    const stars = u.stars === n ? null : n;
    setRating(u.id); setRateError("");
    try {
      await setJcRating(u.id, stars);
      setData((d) => ({ ...d, jcs: d.jcs.map((x) => (x.id === u.id ? { ...x, stars } : x)) }));
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      setRateError(`Rating not saved: ${err.message}`);
    } finally { setRating(""); }
  };
  const metricCount = shown.reduce((n, u) => n + u.metrics.length, 0);
  const jamiatOptions = useMemo(() => (data ? [...new Set(data.jcs.flatMap((u) => u.jamiats))].sort() : []), [data]);

  if (summary) {
    const none = shown.filter((u) => !u.metrics.length).length;
    return (
      <section className="panel jcm-summary" aria-label="JC Metrics">
        <span className="jcm-sum-icon" aria-hidden="true"><BriefcaseIcon /></span>
        <div className="jcm-sum-text">
          <b>JC Metrics{jamiat ? ` · ${jamiat}` : ""}</b>
          {error ? <span className="jcm-error">{error}</span> : !data ? <span className="muted">Loading…</span> : (
            <span className="muted">
              {plural(shown.length, "JC")} · {plural(metricCount, "metric")}
              {none > 0 && <> · <span className="jcm-sum-warn">{none === shown.length ? "none added yet" : `${plural(none, "JC")} ${none === 1 ? "hasn't" : "haven't"} added any`}</span></>}
            </span>
          )}
        </div>
        <Link to="/jc-metrics" className="btn btn-primary jcm-sum-btn">View all →</Link>
      </section>
    );
  }

  return (
    <section className={`panel jcm-panel${heading ? "" : " no-head"}`} aria-label="JC Metrics">
      {heading && <div className="panel-head">
        <div>
          <h2>JC Metrics</h2>
          <p>Work each JC handles besides their Jamaats, as entered by the JC{jamiat ? ` · JCs of ${jamiat}` : ""}.</p>
        </div>
      </div>}
      {error && <p className="jcm-error">{error}</p>}
      {rateError && <p className="jcm-error">{rateError}</p>}
      {!data ? (!error && <p className="empty-state">Loading…</p>) : (
        <>
          <div className="jcm-tools">
            <input className="input" type="search" value={query} placeholder="Search JCs or metrics…" aria-label="Search JCs or metrics" onChange={(e) => setQuery(e.target.value)} />
            {outerJamiat === undefined && jamiatOptions.length > 1 && (
              <select className="jcm-jamiat" value={ownJamiat} aria-label="Jamiat" onChange={(e) => setOwnJamiat(e.target.value)}>
                <option value="">All Jamiats</option>
                {jamiatOptions.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            )}
            <select className="jcm-sort" value={sort} aria-label="Sort JCs" onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
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
                      <small className="muted" title={u.jamiats.length > 3 ? u.jamiats.join(", ") : undefined}>
                        {!u.jamiats.length ? "No Jamiat assigned" : u.jamiats.length > 3 ? `${u.jamiats.slice(0, 3).join(", ")} +${u.jamiats.length - 3} more` : u.jamiats.join(", ")}
                      </small>
                    </div>
                    <span className="jcm-badge" title="Metrics">{u.metrics.length}</span>
                  </header>
                  <Stars value={u.stars} edit={admin} busy={rating === u.id} name={u.name} onRate={(n) => rate(u, n)} />
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

// Sort orders. Unrated JCs go last in both rating orders; ties by name.
const byName = (a, b) => a.name.localeCompare(b.name);
const SORTS = {
  most: { label: "Most metrics first", by: (a, b) => b.metrics.length - a.metrics.length || byName(a, b) },
  fewest: { label: "Fewest metrics first", by: (a, b) => a.metrics.length - b.metrics.length || byName(a, b) },
  best: { label: "Highest rated first", by: (a, b) => (b.stars || 0) - (a.stars || 0) || byName(a, b) },
  worst: { label: "Lowest rated first", by: (a, b) => (a.stars || 6) - (b.stars || 6) || byName(a, b) },
};

// 1-5 stars. Read-only for the Saheb; buttons for the Super Admin.
function Stars({ value, edit, busy, name, onRate }) {
  const label = value ? `${value} of 5 stars` : "Not rated";
  return (
    <div className={`stars${edit ? " is-edit" : ""}${busy ? " is-busy" : ""}`} role={edit ? "group" : "img"} aria-label={edit ? `Star rating for ${name}: ${label}` : label} title={edit ? undefined : label}>
      {[1, 2, 3, 4, 5].map((n) => edit ? (
        <button key={n} type="button" className={n <= (value || 0) ? "on" : ""} disabled={busy}
          aria-label={value === n ? `Clear rating (${n} star${n > 1 ? "s" : ""})` : `Rate ${n} star${n > 1 ? "s" : ""}`}
          title={value === n ? "Click again to clear" : `${n} star${n > 1 ? "s" : ""}`} onClick={() => onRate(n)}>★</button>
      ) : <span key={n} className={n <= (value || 0) ? "on" : ""} aria-hidden="true">★</span>)}
      {!value && <small className="muted">{edit ? "Not rated · click to rate" : "Not rated"}</small>}
    </div>
  );
}
