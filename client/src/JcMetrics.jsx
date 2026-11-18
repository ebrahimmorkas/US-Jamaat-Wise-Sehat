import { useCallback, useEffect, useRef, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { confirmDialog } from "./components/ConfirmDialog";
import { BriefcaseIcon, CheckIcon, CloseIcon, PencilIcon, TrashIcon } from "./components/Icons";
import { AuthError, addMetric, deleteMetric, fetchMyMetrics, isServerStarting, updateMetric } from "./lib/api";
import { plural } from "./lib/helpers";
import { JC_NAV } from "./JcDashboard";

// JC Portal › Metrics: the permanent work this JC handles besides their Jamaats (e.g. "IT department").
// Free text, as many as needed; the Saheb and the Super Admin see them.
export default function JcMetrics({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text }
  const retry = useRef(null);
  const inputRef = useRef(null);

  const fail = useCallback((err, what) => {
    if (err instanceof AuthError) return onAuthExpired();
    setMsg({ type: "error", text: `${what}: ${err.message}` });
  }, [onAuthExpired]);

  const load = useCallback(async (tries = 0) => {
    try {
      const r = await fetchMyMetrics();
      setList(r.metrics);
      setError("");
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setError("Connecting to the server…");
        retry.current = setTimeout(() => load(tries + 1), 5000);
        return;
      }
      setError(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); return () => clearTimeout(retry.current); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const m = await addMetric(text);
      setList((l) => [...l, m]);
      setText("");
      setMsg({ type: "ok", text: `Added “${m.text}”.` });
      inputRef.current && inputRef.current.focus();
    } catch (err) { fail(err, "Not added"); } finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const m = await updateMetric(editing.id, editing.text);
      setList((l) => l.map((x) => (x.id === m.id ? m : x)));
      setEditing(null);
      setMsg({ type: "ok", text: "Metric saved." });
    } catch (err) { fail(err, "Not saved"); } finally { setBusy(false); }
  };

  const remove = async (m) => {
    if (!(await confirmDialog({ tone: "danger", title: "Remove this metric?", confirmText: "Remove", message: `“${m.text}” will be removed. The Saheb and the Super Admin will no longer see it.` }))) return;
    setBusy(true);
    try {
      await deleteMetric(m.id);
      setList((l) => l.filter((x) => x.id !== m.id));
      setMsg({ type: "ok", text: "Metric removed." });
    } catch (err) { fail(err, "Not removed"); } finally { setBusy(false); }
  };

  return (
    <div className="portal">
      <AppBar title="JC Portal" subtitle="Monthly Jamaat follow-up" nav={JC_NAV} page="/jc-portal/metrics"
        theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />

      <main className="container jc-metrics">
        <section className="page-head">
          <div className="page-title">
            <h1>Metrics</h1>
            <p className="page-sub">The work you handle besides your Jamaats (for example “IT department”). The Saheb and the Super Admin can see these.</p>
          </div>
        </section>

        {error && <Notice type={list ? "error" : "info"} text={error} onClose={list ? () => setError("") : undefined} />}
        {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}

        {!list ? (
          !error && <div className="panel portal-empty">Loading…</div>
        ) : (
          <section className="panel metric-panel">
            <form className="metric-add" onSubmit={add}>
              <input ref={inputRef} className="input" value={text} maxLength={300} placeholder="Add a metric, e.g. IT department"
                aria-label="New metric" onChange={(e) => setText(e.target.value)} />
              <button type="submit" className={`btn btn-primary${busy && !editing ? " loading" : ""}`} disabled={busy || !text.trim()}>Add</button>
            </form>

            {!list.length ? (
              <p className="empty-state">You haven't added any metrics yet.</p>
            ) : (
              <>
                <p className="metric-count muted">{plural(list.length, "metric")}</p>
                <ul className="metric-list">
                  {list.map((m, n) => (
                    <li key={m.id} className="metric-item">
                      <span className="metric-no">{n + 1}</span>
                      {editing && editing.id === m.id ? (
                        <form className="metric-edit" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
                          <input className="input" autoFocus value={editing.text} maxLength={300} aria-label="Edit metric"
                            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); }} />
                          <button type="submit" className="icon-btn" title="Save" aria-label="Save" disabled={busy || !editing.text.trim()}><CheckIcon /></button>
                          <button type="button" className="icon-btn" title="Cancel" aria-label="Cancel" onClick={() => setEditing(null)}><CloseIcon /></button>
                        </form>
                      ) : (
                        <>
                          <span className="metric-icon"><BriefcaseIcon /></span>
                          <span className="metric-text">{m.text}</span>
                          <button type="button" className="icon-btn" title="Edit" aria-label={`Edit ${m.text}`} disabled={busy} onClick={() => setEditing({ id: m.id, text: m.text })}><PencilIcon /></button>
                          <button type="button" className="icon-btn" title="Remove" aria-label={`Remove ${m.text}`} disabled={busy} onClick={() => remove(m)}><TrashIcon /></button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
