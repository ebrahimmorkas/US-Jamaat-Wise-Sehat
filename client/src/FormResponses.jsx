import { useCallback, useEffect, useMemo, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { fmtWhen, fmtSize, myZone } from "./components/FormView";
import { DownloadIcon } from "./components/Icons";
import { AuthError, isServerStarting, resultsExcel, resultsGet, resultsList } from "./lib/api";
import { lower, plural } from "./lib/helpers";

// Responses of forms: Super Admin (inside its portal: `embedded`), Saheb and JC (own page with their nav).
// The server decides what each one sees (a JC: only the Jamaats assigned to them).
const STATE = {
  open: { label: "Open", tone: "good" }, not_started: { label: "Not open yet", tone: "info" }, testing: { label: "Testing", tone: "warn" },
  ended: { label: "Ended", tone: "na" }, closed: { label: "Closed", tone: "na" },
};

/** One answer for the table / the detail view. */
function Answer({ v, col, full }) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return <span className="muted">—</span>;
  if (Array.isArray(v) && typeof v[0] === "object") {
    return (
      <span className="rs-files">
        {v.map((f, i) => (
          <a key={i} href={f.url} target="_blank" rel="noreferrer" className="rs-file" title={`${f.name} · ${fmtSize(f.size)}`}>
            {/^image\//.test(f.type || "") && f.url ? <img src={f.url} alt="" loading="lazy" /> : <span className="rs-file-ext">{(f.name.split(".").pop() || "file").toUpperCase()}</span>}
            {full && <span>{f.name} <small className="muted">{fmtSize(f.size)}</small></span>}
          </a>
        ))}
      </span>
    );
  }
  if (Array.isArray(v)) return <>{v.join(", ")}</>;
  if (col.type === "rating") return <>{"★".repeat(Number(v) || 0)} <span className="muted">{v} / {col.max || 5}</span></>;
  const s = String(v);
  if (!full && s.length > 120) return <span title={s}>{s.slice(0, 120)}…</span>;
  return <span className="rs-text">{s}</span>;
}

export default function FormResponses({ embedded, nav, page, user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const [forms, setForms] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [code, setCode] = useState("");
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState({ jamiat: "", jamaat: "", test: "" });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null); // a row shown in full
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((err) => { if (err instanceof AuthError) return onAuthExpired(); setMsg({ type: "error", text: err.message }); }, [onAuthExpired]);
  const loadList = useCallback(async (tries = 0) => {
    try { setForms((await resultsList()).forms); }
    catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) { setLoadMsg("Connecting to the server…"); setTimeout(() => loadList(tries + 1), 5000); }
      else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    setBusy(true);
    resultsGet(code, filter).then((r) => alive && setData(r)).catch((e) => alive && fail(e)).finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [code, filter, fail]);

  const openForm = (c) => { setCode(c); setData(null); setFilter({ jamiat: "", jamaat: "", test: "" }); setQuery(""); setMsg(null); window.scrollTo({ top: 0 }); };
  const back = () => { setCode(""); setData(null); loadList(); };

  const rows = useMemo(() => {
    if (!data) return [];
    const q = lower(query.trim());
    if (!q) return data.rows;
    return data.rows.filter((r) => lower([r.email, r.name, r.jamiat, r.jamaat, ...Object.values(r.answers).map((v) => (Array.isArray(v) ? v.map((x) => (x && x.name) || x).join(" ") : v))].join(" ")).includes(q));
  }, [data, query]);
  const cols = data ? data.form.columns : [];
  const jamaatsOf = data && filter.jamiat ? ((data.places.find((p) => p.jamiat === filter.jamiat) || {}).jamaats || []) : [];

  let body;
  if (!forms) body = <div className="panel portal-empty">{loadMsg}</div>;
  else if (!code) {
    body = (
      <>
        <section className="page-head"><div className="page-title"><h1>Form responses</h1>
          <p className="page-sub">{user && user.role === "jc" ? "Responses from the Jamaats assigned to you." : "Responses from every Jamiat and Jamaat."} Times are in your time{myZone() ? ` (${myZone()})` : ""}.</p></div></section>
        {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}
        {!forms.length ? <Notice type="info" text="No forms have been published yet." /> : (
          <div className="panel">
            <div className="table-wrap">
              <table className="master-table card-rows rs-forms">
                <thead><tr><th>#</th><th>Form</th><th>Status</th><th>Open</th><th>Responses</th><th /></tr></thead>
                <tbody>
                  {forms.map((f, i) => {
                    const s = f.status === "testing" ? STATE.testing : STATE[f.state] || STATE.closed;
                    return (
                      <tr key={f.id}>
                        <td className="idx">{i + 1}</td>
                        <td className="cell-main"><span className="jm-name">{f.title}</span>{f.lastAt && <small className="user-sub">Last response {fmtWhen(f.lastAt)}</small>}</td>
                        <td data-label="Status"><span className={`pill ${s.tone}`}>{s.label}</span></td>
                        <td className="muted" data-label="Open">{fmtWhen(f.startAt)}<br />to {fmtWhen(f.endAt)}</td>
                        <td data-label="Responses"><b>{f.responses}</b>{f.testResponses ? <small className="user-sub">+ {f.testResponses} test</small> : null}</td>
                        <td className="row-actions"><button type="button" className="mini-btn primary" onClick={() => openForm(f.id)}>View responses</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        <button type="button" className="btn btn-ghost back-btn" onClick={back}>← All forms</button>
        <section className="page-head">
          <div className="page-title"><h1>{data ? data.form.title : "Loading…"}</h1>
            {data && <p className="page-sub">{plural(data.total, "response")}{filter.test ? " (test)" : ""}{rows.length !== data.total ? ` · showing ${rows.length}` : ""} · times in your time{myZone() ? ` (${myZone()})` : ""}</p>}</div>
          {data && <button type="button" className="btn btn-primary" disabled={!data.total} onClick={() => resultsExcel(code, filter).catch(fail)}><DownloadIcon /> <span>Download Excel</span></button>}
        </section>
        {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}
        {data && (
          <div className="panel rs-panel">
            <div className="rs-filters">
              <label className="field"><span className="field-label">Jamiat</span>
                <select value={filter.jamiat} onChange={(e) => setFilter({ ...filter, jamiat: e.target.value, jamaat: "" })}>
                  <option value="">All Jamiats</option>{data.places.map((p) => <option key={p.jamiat}>{p.jamiat}</option>)}
                </select></label>
              <label className="field"><span className="field-label">Jamaat</span>
                <select value={filter.jamaat} disabled={!filter.jamiat} onChange={(e) => setFilter({ ...filter, jamaat: e.target.value })}>
                  <option value="">{filter.jamiat ? "All Jamaats" : "Choose a Jamiat first"}</option>{jamaatsOf.map((j) => <option key={j}>{j}</option>)}
                </select></label>
              <label className="field rs-search"><span className="field-label">Search</span>
                <input className="input" type="search" value={query} placeholder="Gmail, name, Jamaat or answer…" onChange={(e) => setQuery(e.target.value)} /></label>
              {data.canSeeTests && <label className="check rs-test"><input type="checkbox" checked={!!filter.test} onChange={(e) => setFilter({ jamiat: "", jamaat: "", test: e.target.checked ? "1" : "" })} /> Show test responses instead</label>}
            </div>
            {busy && <p className="muted">Loading…</p>}
            {!rows.length ? <div className="empty-state">{data.total ? "No response matches." : filter.test ? "No test responses." : "No responses yet."}</div> : (
              <div className="table-wrap rs-wrap">
                <table className="master-table rs-table">
                  <thead><tr><th>#</th><th>Submitted</th><th>Jamiat</th><th>Jamaat</th><th>Filled by</th>
                    {cols.map((c) => <th key={c.key} title={c.label}>{c.label}{c.hidden ? <small className="muted"> (removed)</small> : null}</th>)}<th /></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="idx">{i + 1}</td>
                        <td className="rs-when">{fmtWhen(r.submittedAt)}{r.editedAt && <small className="user-sub">changed {fmtWhen(r.editedAt)}</small>}</td>
                        <td>{r.jamiat || <span className="muted">—</span>}</td>
                        <td><b>{r.jamaat || <span className="muted">—</span>}</b></td>
                        <td className="rs-who">{r.name && <b>{r.name}</b>}<small>{r.email}</small></td>
                        {cols.map((c) => <td key={c.key}><Answer v={r.answers[c.key]} col={c} /></td>)}
                        <td className="row-actions"><button type="button" className="mini-btn" onClick={() => setOpen(r)}>Open</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {open && (
          <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="Response" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
            <div className="panel rs-detail">
              <div className="rs-detail-head">
                <div><h2>{open.jamaat || "Response"}</h2><p className="muted">{open.jamiat} · {fmtWhen(open.submittedAt)}{open.editedAt ? ` · changed ${fmtWhen(open.editedAt)}` : ""}</p>
                  <p>{open.name && <b>{open.name} · </b>}{open.email}</p></div>
                <button type="button" className="btn btn-ghost" onClick={() => setOpen(null)}>Close</button>
              </div>
              <dl className="rs-dl">
                {cols.map((c) => <div key={c.key}><dt>{c.label}</dt><dd><Answer v={open.answers[c.key]} col={c} full /></dd></div>)}
              </dl>
            </div>
          </div>
        )}
      </>
    );
  }

  if (embedded) return body;
  return (
    <>
      <AppBar nav={nav} page={page} theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut}
        {...(user && user.role === "jc" ? { title: "JC Portal", subtitle: "Monthly Jamaat follow-up" } : {})} />
      <main className="container rs-page">{body}</main>
    </>
  );
}
