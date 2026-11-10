import { useCallback, useEffect, useRef, useState } from "react";
import Notice from "./components/Notice";
import { AuthError, auditList, errorList } from "./lib/api";

const TABS = [
  { key: "all", label: "All activity" },
  { key: "changes", label: "Changes (audit trail)" },
  { key: "signin", label: "Sign-ins" },
  { key: "access", label: "Access denied" },
  { key: "errors", label: "Errors" },
];

const ACTION_LABELS = {
  login_success: "Signed in",
  login_failed: "Sign-in refused",
  logout: "Signed out",
  token_refreshed: "Session renewed",
  token_reuse_detected: "Stolen session blocked",
  access_denied: "Access denied",
  dashboard_opened: "Opened the dashboard",
  admin_opened: "Opened the Super Admin portal",
  portal_opened: "Opened the JC portal",
  data_refresh: "Clicked Refresh",
  list_viewed: "Viewed a Jamaat list",
  entry_viewed: "Opened a Jamaat form",
  audit_viewed: "Viewed the logs",
  user_created: "Added a user",
  user_updated: "Changed a user",
  user_deleted: "Deleted a user",
  dropdown_updated: "Changed a dropdown list",
  field_created: "Added a question",
  field_updated: "Changed a question",
  field_deleted: "Deleted a question",
  entry_submitted: "Saved a Jamaat form",
  master_created: "Added to masters",
  master_updated: "Changed masters",
  master_deleted: "Deleted from masters",
};
const ROLE_LABELS = { saheb: "Saheb", superadmin: "Super Admin", jc: "JC" };
const REASONS = {
  not_registered: "Gmail not registered",
  inactive: "account deactivated",
  google_verify_failed: "Google sign-in could not be verified",
  google_account_mismatch: "different Google account",
  jamaat_not_assigned: "Jamaat not assigned to this JC",
  request_from_another_site: "request from another website",
};

const fmtTime = (d) => new Date(d).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const show = (v) => {
  if (v === null || v === undefined || v === "") return <span className="muted">—</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

// One short line with the useful details of an event (reason, page, month…).
function detailLine(item) {
  const d = item.details || {};
  const parts = [];
  if (d.reason) parts.push(REASONS[d.reason] || d.reason);
  if (d.method && d.path) parts.push(`${d.method} ${d.path}`);
  else if (d.page) parts.push(`page ${d.page}`);
  if (d.month && item.action !== "entry_submitted") parts.push(d.month);
  if (d.metric) parts.push(`${d.metric}: ${d.status}`);
  if (d.firstSubmission) parts.push("first submission");
  if (d.unchanged) parts.push("saved without changes");
  if (d.via) parts.push(`via ${d.via}`);
  if (d.op) parts.push(d.op + (d.users !== undefined ? ` (${d.users} JC${d.users === 1 ? "" : "s"})` : ""));
  if (d.savedFormsRenamed) parts.push(`renamed in ${d.savedFormsRenamed} saved form(s)`);
  if (d.jamaatsRenamed) parts.push(`renamed in ${d.jamaatsRenamed} Jamaat(s)`);
  if (d.method === "dev") parts.push("local test sign-in");
  return parts.join(" · ");
}

// Super Admin: everything that happened in the software.
export default function Logs({ onAuthExpired }) {
  const [tab, setTab] = useState("all");
  const [filters, setFilters] = useState({ user: "", q: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(""); // expanded error id
  const seq = useRef(0);

  const params = useCallback((before) => {
    const p = {
      limit: 50,
      before,
      from: applied.from ? new Date(`${applied.from}T00:00:00`).toISOString() : "",
      to: applied.to ? new Date(`${applied.to}T23:59:59`).toISOString() : "",
    };
    if (tab === "errors") return { ...p, q: applied.q || applied.user };
    return { ...p, category: tab === "all" ? "" : tab, user: applied.user, q: applied.q };
  }, [tab, applied]);

  const load = useCallback(async (before) => {
    const my = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const res = await (tab === "errors" ? errorList : auditList)(params(before));
      if (my !== seq.current) return;
      setItems((old) => (before ? [...old, ...res.items] : res.items));
      setNext(res.next);
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (my === seq.current) setError(err.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [tab, params, onAuthExpired]);

  useEffect(() => { load(); }, [load]);

  const apply = (e) => { e.preventDefault(); setApplied(filters); };
  const reset = () => { const empty = { user: "", q: "", from: "", to: "" }; setFilters(empty); setApplied(empty); };

  return (
    <>
      <section className="page-head">
        <div className="page-title">
          <h1>Logs</h1>
          <p className="page-sub">Who did what and when: sign-ins, changes with their previous values, access denied, and errors. Kept for 365 days.</p>
        </div>
      </section>

      <div className="log-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            className={`log-tab${tab === t.key ? " is-on" : ""}`} onClick={() => { setTab(t.key); setOpen(""); }}>{t.label}</button>
        ))}
      </div>

      <form className="panel log-filters" onSubmit={apply}>
        {tab !== "errors" && (
          <label className="field"><span className="field-label">User (Gmail)</span>
            <input className="input" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} placeholder="e.g. name@gmail.com" /></label>
        )}
        <label className="field"><span className="field-label">{tab === "errors" ? "Search (message, user, reference)" : "Search (Jamaat, question, page…)"}</span>
          <input className="input" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder={tab === "errors" ? "e.g. 9F3A1C2B" : "e.g. DHANERA"} /></label>
        <label className="field"><span className="field-label">From</span>
          <input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="field"><span className="field-label">To</span>
          <input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <div className="log-filter-actions">
          <button type="button" className="btn btn-ghost" onClick={reset}>Reset</button>
          <button type="submit" className="btn btn-primary">Apply</button>
        </div>
      </form>

      {error && <Notice type="error" text={error} onClose={() => setError("")} />}

      <div className="panel log-list">
        {tab === "errors"
          ? items.map((e) => (
              <article key={e._id} className="log-item">
                <button type="button" className="log-row" onClick={() => setOpen(open === e._id ? "" : e._id)} aria-expanded={open === e._id}>
                  <span className="log-time">{fmtTime(e.at)}</span>
                  <span className={`pill ${e.source === "server" ? "bad" : "warn"}`}>{e.source === "server" ? "Server" : "Website"}</span>
                  <span className="log-main"><b>{e.message}</b><small>{e.path}{e.status ? ` · ${e.status}` : ""}</small></span>
                  <span className="log-who">{e.username || <span className="muted">not signed in</span>}{e.role && <small>{ROLE_LABELS[e.role] || e.role}</small>}</span>
                  <span className="log-ref">Ref {e.ref}</span>
                </button>
                {open === e._id && (
                  <div className="log-extra">
                    {e.details && <div className="muted">{show(e.details)}</div>}
                    <pre className="log-stack">{e.stack || "No stack trace."}</pre>
                    <div className="muted">IP {e.ip || "—"} · {e.userAgent || ""}</div>
                  </div>
                )}
              </article>
            ))
          : items.map((a) => (
              <article key={a._id} className={`log-item${a.success === false ? " is-fail" : ""}`}>
                <div className="log-row static">
                  <span className="log-time">{fmtTime(a.at)}</span>
                  <span className={`pill ${a.success === false ? "bad" : a.changes ? "info" : "na"}`}>{ACTION_LABELS[a.action] || a.action}</span>
                  <span className="log-main">
                    <b>{a.target && a.target.label ? a.target.label : detailLine(a) || " "}</b>
                    {a.target && a.target.label && detailLine(a) && <small>{detailLine(a)}</small>}
                  </span>
                  <span className="log-who">{a.username || <span className="muted">—</span>}{a.role && <small>{ROLE_LABELS[a.role] || a.role}</small>}</span>
                  <span className="log-ip" title={a.userAgent || ""}>{a.ip || ""}</span>
                </div>
                {a.changes && a.changes.length > 0 && (
                  <table className="log-changes">
                    <thead><tr><th>Field</th><th>Previous value</th><th>New value</th></tr></thead>
                    <tbody>
                      {a.changes.map((c, i) => (
                        <tr key={i}><td>{c.label || c.field}</td><td className="old">{show(c.from)}</td><td className="new">{show(c.to)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </article>
            ))}

        {!loading && !items.length && <div className="empty-state">Nothing found.</div>}
        {loading && <div className="empty-state">Loading…</div>}
        {next && !loading && (
          <div className="log-more"><button type="button" className="btn btn-ghost" onClick={() => load(next)}>Load more</button></div>
        )}
      </div>
    </>
  );
}
