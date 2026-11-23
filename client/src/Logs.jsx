import { useCallback, useEffect, useRef, useState } from "react";
import Notice from "./components/Notice";
import { TrashIcon } from "./components/Icons";
import { AuthError, auditList, errorList, purgeLogs } from "./lib/api";

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
  comments_viewed: "Viewed comments",
  entry_viewed: "Opened a Jamaat form",
  audit_viewed: "Viewed the logs",
  chat_asked: "Asked the assistant",
  data_viewed: "Opened the Data tab",
  data_downloaded: "Downloaded the Data Excel",
  data_uploaded: "Uploaded a Data Excel file",
  data_cleared: "Removed the uploaded data",
  data_changed: "Changed a Data value",
  data_choices_changed: "Changed the Data dropdown choices",
  metric_added: "Added a metric",
  metric_updated: "Changed a metric",
  metric_deleted: "Removed a metric",
  jc_rated: "Rated a JC",
  stats_uploaded: "Uploaded a Stats image",
  stats_deleted: "Removed a Stats image",
  form_created: "Created a form",
  form_updated: "Changed a form",
  form_status_changed: "Changed a form's status",
  form_deleted: "Deleted a form",
  form_restored: "Restored a form",
  form_links_downloaded: "Downloaded form links",
  form_test_cleared: "Removed test responses",
  form_submitted: "Filled a form",
  form_responses_exported: "Downloaded form responses",
  form_announced: "Emailed the form to Jamaat Coordinators",
  email_sent: "Sent an email",
  email_cancelled: "Cancelled a scheduled email",
  email_settings_changed: "Changed the email provider",
  storage_settings_changed: "Changed the image storage",
  storage_tested: "Tested an image storage",
  email_template_saved: "Saved an email template",
  email_template_deleted: "Deleted an email template",
  email_template_restored: "Restored an email template",
  reminder_sent: "Sent a form reminder",
  report_format_saved: "Saved a report format",
  report_format_deleted: "Deleted a report format",
  report_photos_chosen: "Chose photos for a report",
  report_generated: "Generated a report",
  report_photo_downloaded: "Downloaded a form photo",
  email_file_published: "Added an image / document to an email",
  form_response_edited: "Changed a form response",
  logs_deleted: "Deleted logs permanently",
  user_created: "Added a user",
  user_updated: "Changed a user",
  user_deleted: "Deleted a user (status D)",
  user_restored: "Restored a user",
  dropdown_updated: "Changed a dropdown list",
  field_created: "Added a question",
  field_updated: "Changed a question",
  field_deleted: "Deleted a question (status D)",
  field_restored: "Restored a question",
  entry_submitted: "Saved a Jamaat form",
  master_created: "Added to masters",
  master_updated: "Changed masters",
  master_deleted: "Deleted from masters (status D)",
  master_restored: "Restored in masters",
};
const ROLE_LABELS = { saheb: "Saheb", superadmin: "Super Admin", jc: "JC", jamaat_coordinator: "Jamaat Coordinator", media: "Media" };
const REASONS = {
  not_registered: "Gmail not registered",
  inactive: "account deactivated",
  deleted: "account deleted (status D)",
  google_verify_failed: "Google sign-in could not be verified",
  google_account_mismatch: "different Google account",
  jamaat_not_assigned: "Jamaat not assigned to this JC",
  locked_jamaat_details: "tried to change locked Jamaat details (nothing saved)",
  request_from_another_site: "request from another website",
};

const fmtTime = (d) => new Date(d).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "");
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
  if (item.action === "data_uploaded") parts.push(d.file || "", `${d.rows} rows`, d.unmatched ? `${d.unmatched} left out` : "", d.kept != null ? `${d.kept} kept, ${d.added} new, ${d.removed} removed` : "");
  if (item.action === "data_downloaded" || item.action === "data_viewed" || item.action === "data_cleared") parts.push(`${d.rows} rows`);
  if (item.action === "chat_asked") parts.push(`“${d.question}”`, d.read === "ai" ? "read by AI" : "read by built-in reader");
  if (item.action === "logs_deleted") {
    parts.push({ activity: "activity logs", errors: "error logs", both: "activity + error logs" }[d.kind] || d.kind);
    if (d.range === "all") parts.push("all dates");
    if (d.range === "older") parts.push(`older than ${d.days} days`);
    if (d.range === "between") parts.push(`${fmtDay(d.from)} – ${fmtDay(d.to)}`);
    parts.push(`${d.activity || 0} activity, ${d.errors || 0} errors deleted`);
  }
  return parts.filter(Boolean).join(" · ");
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
  const [purging, setPurging] = useState(false); // "Delete logs" popup open
  const [done, setDone] = useState("");
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
          <p className="page-sub">Who did what and when: sign-ins, changes with their previous values, access denied, and errors. Deleted automatically after 365 days.</p>
        </div>
        <button type="button" className="btn btn-danger-ghost" onClick={() => { setDone(""); setPurging(true); }}>
          <TrashIcon /><span>Delete logs</span>
        </button>
      </section>
      {purging && (
        <PurgeDialog tab={tab} onAuthExpired={onAuthExpired} onClose={(msg) => {
          setPurging(false);
          if (msg) { setDone(msg); load(); }
        }} />
      )}
      {done && <Notice type="ok" text={done} onClose={() => setDone("")} />}

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

const DAYS = [30, 90, 180];
const WHAT = [
  { key: "activity", label: "Activity logs", sub: "sign-ins, changes, pages opened" },
  { key: "errors", label: "Error logs", sub: "server and website errors" },
  { key: "both", label: "Both" },
];
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

// "Delete logs" popup: choose which logs and which dates, see how many, type DELETE, delete for good.
function PurgeDialog({ tab, onClose, onAuthExpired }) {
  const ref = useRef(null);
  const [kind, setKind] = useState(tab === "errors" ? "errors" : "activity");
  const [range, setRange] = useState("older");
  const [days, setDays] = useState(90);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [count, setCount] = useState(null); // { activity, errors } or null while counting
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);

  const body = useCallback(() => ({
    kind, range, days,
    from: range === "between" && from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: range === "between" && to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  }), [kind, range, days, from, to]);

  // Count what would be deleted whenever the choice changes.
  useEffect(() => {
    setCount(null); setError("");
    if (range === "between" && (!from || !to)) return;
    let live = true;
    purgeLogs({ ...body(), dryRun: true })
      .then((r) => live && setCount(r))
      .catch((err) => { if (err instanceof AuthError) return onAuthExpired(); if (live) setError(err.message); });
    return () => { live = false; };
  }, [body, range, from, to, onAuthExpired]);

  const total = count ? count.activity + count.errors : 0;
  const ready = count && total > 0 && typed.trim().toUpperCase() === "DELETE" && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError("");
    try {
      const r = await purgeLogs({ ...body(), confirm: "DELETE" });
      const parts = [];
      if (kind !== "errors") parts.push(plural(r.activity, "activity log"));
      if (kind !== "activity") parts.push(plural(r.errors, "error log"));
      onClose(`Deleted permanently: ${parts.join(" and ")}.`);
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      setError(err.message); setBusy(false);
    }
  };

  const opt = (name, value, cur, set, label, sub) => (
    <label key={String(value)} className={`seg-opt tone-bad${cur === value ? " is-on" : ""}`}>
      <input type="radio" name={name} checked={cur === value} onChange={() => set(value)} />
      <span>{label}{sub && <small className="purge-sub">{sub}</small>}</span>
    </label>
  );

  return (
    <dialog ref={ref} className="confirm-dlg cd-danger purge-dlg" aria-labelledby="purgeTitle"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => { if (e.target === ref.current && !busy) onClose(); }}>
      <form onSubmit={submit}>
        <div className="confirm-main">
          <span className="confirm-icon"><TrashIcon /></span>
          <div className="confirm-text">
            <h2 id="purgeTitle">Delete logs permanently</h2>
            <p>Deleted logs cannot be restored. A short note that you deleted them (which logs, dates and how many) is kept in the log.</p>
          </div>
        </div>
        <div className="purge-body">
          <fieldset className="purge-step">
            <legend>1. Which logs?</legend>
            <div className="seg-control purge-opts">{WHAT.map((w) => opt("purge-kind", w.key, kind, setKind, w.label, w.sub))}</div>
          </fieldset>
          <fieldset className="purge-step">
            <legend>2. Which dates?</legend>
            <div className="seg-control purge-opts">
              {opt("purge-range", "older", range, setRange, "Older than…")}
              {opt("purge-range", "between", range, setRange, "Between dates")}
              {opt("purge-range", "all", range, setRange, "Everything")}
            </div>
            {range === "older" && (
              <div className="purge-days">
                {DAYS.map((d) => (
                  <button key={d} type="button" className={`chip-btn${days === d ? " is-on" : ""}`} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>
                ))}
                <label className="purge-custom">or <input className="input" type="number" min="1" max="3650" value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(3650, parseInt(e.target.value, 10) || 1)))} aria-label="Number of days" /> days</label>
              </div>
            )}
            {range === "between" && (
              <div className="purge-dates">
                <label className="field"><span className="field-label">From</span><input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
                <label className="field"><span className="field-label">To</span><input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
              </div>
            )}
          </fieldset>
          <div className={`purge-count${count && total ? " has" : ""}`} aria-live="polite">
            {range === "between" && (!from || !to) ? "Choose both dates."
              : !count ? "Counting…"
              : total === 0 ? "Nothing to delete for this choice."
              : <>This will delete <b>{[kind !== "errors" && plural(count.activity, "activity log"), kind !== "activity" && plural(count.errors, "error log")].filter(Boolean).join(" and ")}</b>.</>}
          </div>
          {count && total > 0 && (
            <label className="field purge-type"><span className="field-label">3. Type <b>DELETE</b> to confirm</span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck="false" placeholder="DELETE" /></label>
          )}
          {error && <Notice type="error" text={error} onClose={() => setError("")} />}
        </div>
        <div className="confirm-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={!ready}>{busy ? "Deleting…" : "Delete permanently"}</button>
        </div>
      </form>
    </dialog>
  );
}
