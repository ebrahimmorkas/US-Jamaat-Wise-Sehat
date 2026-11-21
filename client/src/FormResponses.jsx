import { useCallback, useEffect, useMemo, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { fmtWhen, fmtSize, myZone } from "./components/FormView";
import { CheckIcon, ChevronLeft, ChevronRight, ClockIcon, CloseIcon, DownloadIcon, EyeIcon, LockIcon, PencilIcon, UsersIcon } from "./components/Icons";
import { AuthError, isServerStarting, resultsExcel, resultsGet, resultsList, resultsStatus, resultsStatusExcel } from "./lib/api";
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

const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

/** One answer drawn the way the person saw the question while filling it (read-only). */
function FilledAnswer({ f, v }) {
  if (empty(v)) return <p className="rs-none">No answer</p>;
  const list = Array.isArray(v) ? v : [v];
  switch (f.type) {
    case "radio": case "checkbox": {
      const opts = f.options && f.options.length ? [...f.options, ...list.filter((x) => !f.options.includes(x))] : list;
      return (
        <div className="fv-choices">
          {opts.map((o) => {
            const on = list.includes(o);
            return (
              <div key={o} className={`fv-choice rs-choice${on ? " is-on" : ""}`}>
                <input type={f.type === "radio" ? "radio" : "checkbox"} checked={on} readOnly tabIndex={-1} aria-readonly="true" /> <span>{o}</span>
                {on && <span className="rs-chosen">Chosen</span>}
              </div>
            );
          })}
        </div>
      );
    }
    case "yes_no":
      return <div className="fv-yesno">{["Yes", "No"].map((o) => <span key={o} className={`fv-pick rs-pick${v === o ? " is-on" : ""}`}>{o}</span>)}</div>;
    case "rating": {
      const stars = f.max || 5;
      const cur = Number(v) || 0;
      return (
        <div className="fv-stars" aria-label={`${cur} of ${stars}`}>
          {Array.from({ length: stars }, (_, i) => <span key={i} className={`fv-star-btn rs-star${i < cur ? " is-on" : ""}`}>★</span>)}
          <span className="fv-star-text">{cur} of {stars}</span>
        </div>
      );
    }
    case "image": case "video": case "file":
      return (
        <div className="fv-files">
          {list.map((x, i) => (
            <a key={i} className="fv-file rs-filerow" href={x.url || undefined} target="_blank" rel="noreferrer">
              {/^image\//.test(x.type || "") && x.url ? <img src={x.url} alt="" loading="lazy" /> : <span className="rs-file-ext">{(String(x.name || "").split(".").pop() || "file").toUpperCase()}</span>}
              <span className="fv-file-text"><span className="fv-file-name">{x.name || "File"}</span><span className="fv-file-sub">{x.size ? fmtSize(x.size) : ""}{x.url ? " · Open" : " · link not available"}</span></span>
            </a>
          ))}
        </div>
      );
    case "multi_select":
      return <div className="rs-tags">{list.map((x) => <span key={x} className="rs-tag">{x}</span>)}</div>;
    case "long_text":
      return <div className="rs-box rs-long">{String(v)}</div>;
    default:
      return <div className="rs-box">{list.join(", ")}</div>;
  }
}

/** One response, shown like the form the person filled. */
export function ResponseView({ form, row, n, total, onPrev, onNext, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, onClose]);
  const fields = form.fields || form.columns;
  let q = 0;
  return (
    <div className="preview-overlay rs-view" role="dialog" aria-modal="true" aria-label="Response">
      <div className="rs-view-bar">
        <div className="rs-view-nav">
          <button type="button" className="icon-btn" onClick={onPrev || undefined} disabled={!onPrev} aria-label="Previous response" title="Previous (←)"><ChevronLeft size={20} /></button>
          <span className="rs-view-count">Response <b>{n}</b> of {total}</span>
          <button type="button" className="icon-btn" onClick={onNext || undefined} disabled={!onNext} aria-label="Next response" title="Next (→)"><ChevronRight size={20} /></button>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose}><CloseIcon /> <span>Close</span></button>
      </div>
      <div className="rs-view-scroll">
        <div className="fill-main">
          <div className="fill-form">
            <div className="panel fill-place rs-who-card">
              {row.byJc && (
                <div className="rs-jc-banner"><UsersIcon /><span>Filled by <b>JC {row.byJc.name || row.byJc.email}</b> on behalf of the Jamaat Coordinator — not by the Coordinator.</span></div>
              )}
              <div className="fill-place-grid">
                <div className="field"><span className="field-label">Jamiat</span><span className="fill-locked"><LockIcon /> {row.jamiat || "—"}</span></div>
                <div className="field"><span className="field-label">Jamaat</span><span className="fill-locked"><LockIcon /> {row.jamaat || "—"}</span></div>
              </div>
              <div className="rs-meta">
                {row.byJc ? (
                  <div><span className="field-label">Filled by (JC)</span><p><b>{row.byJc.name || row.byJc.email}</b>{row.byJc.name && <><br /><span className="rs-mail">{row.byJc.email}</span></>}
                    <br /><small className="muted">For the Coordinator: {row.name || row.email || "none yet"}</small></p></div>
                ) : (
                  <div><span className="field-label">Filled by</span><p>{row.name && <b>{row.name}<br /></b>}<span className="rs-mail">{row.email || "—"}</span></p></div>
                )}
                <div><span className="field-label">Submitted</span><p>{fmtWhen(row.submittedAt)}{row.editedAt && <><br /><small className="muted">Changed {fmtWhen(row.editedAt)}{row.editedBy ? ` by ${row.editedBy.role === "jc" ? "JC " : ""}${row.editedBy.name || row.editedBy.email}` : ""}</small></>}</p></div>
              </div>
            </div>
            <div className="panel fv-card">
              <div className="fv">
                {form.topImage && <img className="fv-top" src={form.topImage} alt="" />}
                <div className="fv-head">
                  <h1>{form.title}</h1>
                  {form.description && <p className="fv-desc">{form.description}</p>}
                </div>
                {fields.map((f) => {
                  const v = row.answers[f.key];
                  if (f.type === "heading" || f.type === "info") {
                    if (f.hidden) return null;
                    return f.type === "heading"
                      ? <div key={f.key} className="fv-section"><h2>{f.label}</h2>{f.help && <p>{f.help}</p>}</div>
                      : <div key={f.key} className="fv-info">{f.label && <b>{f.label}</b>}{f.help && <p>{f.help}</p>}</div>;
                  }
                  if (f.hidden && empty(v)) return null;
                  if (!f.hidden) q += 1;
                  return (
                    <section key={f.key} className="fv-q rs-q">
                      <div className="fv-label">{!f.hidden && <span className="fv-n">{q}.</span>} {f.label}{f.required && <span className="fv-star"> *</span>}
                        {f.hidden && <span className="pill na rs-removed">Question removed later</span>}</div>
                      {f.help && <p className="fv-help">{f.help}</p>}
                      <FilledAnswer f={f} v={v} />
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Jamaat status: every Jamaat, filled or not ---------- */
const DAY = 24 * 3600 * 1000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
/** The date filter -> { from, to } as ISO times (in the viewer's time zone). */
function rangeOf(when) {
  const today = new Date();
  if (when.preset === "today") return { from: startOfDay(today).toISOString(), to: endOfDay(today).toISOString() };
  if (when.preset === "7" || when.preset === "30") return { from: startOfDay(new Date(Date.now() - (Number(when.preset) - 1) * DAY)).toISOString(), to: endOfDay(today).toISOString() };
  if (when.preset === "date" && when.from) return { from: startOfDay(`${when.from}T00:00`).toISOString(), to: endOfDay(`${when.from}T00:00`).toISOString() };
  if (when.preset === "range" && (when.from || when.to)) {
    return { from: when.from ? startOfDay(`${when.from}T00:00`).toISOString() : "", to: when.to ? endOfDay(`${when.to}T00:00`).toISOString() : "" };
  }
  return { from: "", to: "" };
}
const PRESETS = [["any", "Any time"], ["today", "Today"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["date", "On a date"], ["range", "Date range"]];

function StatusView({ code, isJc, fail, onShowResponses }) {
  const [f, setF] = useState({ status: "", jamiat: "", jamaat: "" });
  const [when, setWhen] = useState({ preset: "any", from: "", to: "" });
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const range = useMemo(() => rangeOf(when), [when]);
  const params = useMemo(() => ({ ...f, ...range }), [f, range]);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    resultsStatus(code, params).then((r) => alive && setData(r)).catch((e) => alive && fail(e)).finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [code, params, fail]);

  if (!data) return <div className="panel portal-empty">Loading…</div>;
  const q = lower(query.trim());
  const rows = q ? data.rows.filter((r) => lower([r.jamiat, r.jamaat, r.coordinator && r.coordinator.name, r.coordinator && r.coordinator.email, r.last && r.last.name].join(" ")).includes(q)) : data.rows;
  const sm = data.summary;
  const pct = sm.jamaats ? Math.round((sm.filled / sm.jamaats) * 100) : 0;
  const jamaatsOf = f.jamiat ? ((data.places.find((p) => p.jamiat === f.jamiat) || {}).jamaats || []) : [];
  const dated = when.preset !== "any";
  const setStatus = (v) => setF({ ...f, status: v });

  return (
    <>
      <div className="st-cards">
        <button type="button" className={`st-card${!f.status ? " is-on" : ""}`} onClick={() => setStatus("")}>
          <span className="st-icon brand"><UsersIcon /></span><span className="st-num">{sm.jamaats}</span><span className="st-label">{isJc ? "Your Jamaats" : "Jamaats"}</span>
        </button>
        <button type="button" className={`st-card${f.status === "filled" ? " is-on" : ""}`} onClick={() => setStatus("filled")}>
          <span className="st-icon good"><CheckIcon /></span><span className="st-num">{sm.filled}</span><span className="st-label">Filled{dated ? " (in the dates)" : ""}</span>
          <span className="st-bar"><span style={{ width: `${pct}%` }} /></span><span className="st-pct">{pct}%</span>
        </button>
        <button type="button" className={`st-card${f.status === "not_filled" ? " is-on" : ""}`} onClick={() => setStatus("not_filled")}>
          <span className="st-icon bad"><ClockIcon /></span><span className="st-num">{sm.notFilled}</span><span className="st-label">Not filled{dated ? " (in the dates)" : ""}</span>
        </button>
        <div className="st-card is-static">
          <span className="st-icon info"><PencilIcon /></span><span className="st-num">{sm.byJc}</span><span className="st-label">Filled by a JC</span>
        </div>
      </div>

      <div className="panel rs-panel st-panel">
        <div className="st-filters">
          <div className="field"><span className="field-label">Status</span>
            <div className="cp-tabs st-seg" role="tablist">
              {[["", "All"], ["filled", "Filled"], ["not_filled", "Not filled"]].map(([v, label]) => (
                <button key={v || "all"} type="button" role="tab" aria-selected={f.status === v} className={f.status === v ? "is-on" : ""} onClick={() => setStatus(v)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="field"><span className="field-label">Jamiat</span>
            <select value={f.jamiat} onChange={(e) => setF({ ...f, jamiat: e.target.value, jamaat: "" })}>
              <option value="">All Jamiats</option>{data.places.map((p) => <option key={p.jamiat}>{p.jamiat}</option>)}
            </select></label>
          <label className="field"><span className="field-label">Jamaat</span>
            <select value={f.jamaat} disabled={!f.jamiat} onChange={(e) => setF({ ...f, jamaat: e.target.value })}>
              <option value="">{f.jamiat ? "All Jamaats" : "Choose a Jamiat first"}</option>{jamaatsOf.map((j) => <option key={j}>{j}</option>)}
            </select></label>
          <label className="field"><span className="field-label">Filled</span>
            <select value={when.preset} onChange={(e) => setWhen({ preset: e.target.value, from: "", to: "" })}>
              {PRESETS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select></label>
          {when.preset === "date" && (
            <label className="field"><span className="field-label">Date</span>
              <input className="input" type="date" value={when.from} onChange={(e) => setWhen({ ...when, from: e.target.value })} /></label>
          )}
          {when.preset === "range" && (
            <>
              <label className="field"><span className="field-label">From</span>
                <input className="input" type="date" value={when.from} max={when.to || undefined} onChange={(e) => setWhen({ ...when, from: e.target.value })} /></label>
              <label className="field"><span className="field-label">To</span>
                <input className="input" type="date" value={when.to} min={when.from || undefined} onChange={(e) => setWhen({ ...when, to: e.target.value })} /></label>
            </>
          )}
          <label className="field rs-search"><span className="field-label">Search</span>
            <input className="input" type="search" value={query} placeholder="Jamaat or Coordinator…" onChange={(e) => setQuery(e.target.value)} /></label>
        </div>
        <div className="st-tools">
          <span className="muted">{busy ? "Loading…" : `${plural(rows.length, "Jamaat")}${dated ? " · “Filled” means a response sent in the chosen dates" : ""}`}</span>
          {(f.status || f.jamiat || dated || query) && <button type="button" className="link-btn" onClick={() => { setF({ status: "", jamiat: "", jamaat: "" }); setWhen({ preset: "any", from: "", to: "" }); setQuery(""); }}>Clear filters</button>}
          <button type="button" className="btn btn-ghost st-xl" disabled={!rows.length} onClick={() => resultsStatusExcel(code, params).catch(fail)}><DownloadIcon /> <span>Download Excel</span></button>
        </div>
        {isJc && data.canFill && (
          <p className="st-hint"><UsersIcon /> <span>You can fill this form for any of your Jamaats. It will be marked <b>filled by JC</b>, not by the Jamaat Coordinator.</span></p>
        )}
        {!rows.length ? <div className="empty-state">{data.rows.length ? "No Jamaat matches the search." : f.status === "filled" ? "No Jamaat has filled it yet." : f.status === "not_filled" ? "Every Jamaat has filled it." : "No Jamaats."}</div> : (
          <div className="table-wrap rs-wrap">
            <table className="master-table card-rows st-table">
              <thead><tr><th>#</th><th>Jamiat</th><th>Jamaat</th><th>Jamaat Coordinator</th><th>Status</th><th>Filled by</th><th>Last filled</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.jamiat}/${r.jamaat}`} className={r.filled ? "" : "is-missing"}>
                    <td className="idx">{i + 1}</td>
                    <td data-label="Jamiat">{r.jamiat}</td>
                    <td className="cell-main" data-label="Jamaat"><b>{r.jamaat}</b></td>
                    <td data-label="Coordinator" className="rs-who">{r.coordinator ? <>{r.coordinator.name && <b>{r.coordinator.name}</b>}<small>{r.coordinator.email}</small>{!r.coordinator.active && <span className="pill na">Disabled</span>}</> : <span className="muted">No Coordinator</span>}</td>
                    <td data-label="Status">{r.filled ? <span className="pill good">Filled{r.count > 1 ? ` ×${r.count}` : ""}</span> : <span className="pill bad">Not filled</span>}</td>
                    <td data-label="Filled by">{!r.last ? <span className="muted">—</span> : r.last.by === "jc"
                      ? <span className="st-by"><span className="pill info">JC</span> {r.last.name}<small className="muted">on behalf of the Coordinator</small></span>
                      : <span className="st-by"><span className="pill na">Coordinator</span> {r.last.name}</span>}</td>
                    <td data-label="Last filled" className="rs-when">{r.last ? <>{fmtWhen(r.last.at)}{r.last.editedAt && <small className="user-sub">changed {fmtWhen(r.last.editedAt)}</small>}</> : <span className="muted">—</span>}</td>
                    <td className="row-actions st-actions">
                      {r.filled && <button type="button" className="mini-btn" onClick={() => onShowResponses(r.jamiat, r.jamaat)}><EyeIcon /> <span>View</span></button>}
                      {r.fillFor && (!r.filled || data.allowEdit || data.maxPerPerson == null || r.count < data.maxPerPerson) && (
                        <a className={`mini-btn${r.filled ? "" : " primary"}`} href={`/f/${code}?for=${encodeURIComponent(r.fillFor)}`}>
                          <PencilIcon /> <span>{r.filled ? (data.allowEdit ? "Change / fill" : "Fill again") : "Fill for Jamaat"}</span></a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default function FormResponses({ embedded, nav, page, user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const [forms, setForms] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [code, setCode] = useState("");
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState({ jamiat: "", jamaat: "", test: "" });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null); // index (in `rows`) of the response shown in full
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("status"); // "status" (every Jamaat) | "responses"
  const isJc = !!user && user.role === "jc";

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

  useEffect(() => { setOpen(null); }, [code, filter, query]);
  const openForm = (c) => { setCode(c); setData(null); setTab("status"); setFilter({ jamiat: "", jamaat: "", test: "" }); setQuery(""); setMsg(null); window.scrollTo({ top: 0 }); };
  const showResponses = (jamiat, jamaat) => { setFilter({ jamiat, jamaat, test: "" }); setQuery(""); setTab("responses"); };
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
          <p className="page-sub">{isJc ? "Responses from the Jamaats assigned to you. Open a form to see which Jamaats have filled it, and to fill it for a Jamaat." : "Responses from every Jamiat and Jamaat."} Times are in your time{myZone() ? ` (${myZone()})` : ""}.</p></div></section>
        {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}
        {!forms.length ? <Notice type="info" text="No forms have been published yet." /> : (
          <div className="panel">
            <div className="table-wrap">
              <table className="master-table card-rows rs-forms">
                <thead><tr><th>#</th><th>Form</th><th>Status</th><th>Open</th><th>{isJc ? "Your Jamaats filled" : "Jamaats filled"}</th><th>Responses</th><th /></tr></thead>
                <tbody>
                  {forms.map((f, i) => {
                    const s = f.status === "testing" ? STATE.testing : STATE[f.state] || STATE.closed;
                    return (
                      <tr key={f.id}>
                        <td className="idx">{i + 1}</td>
                        <td className="cell-main"><span className="jm-name">{f.title}</span>{f.lastAt && <small className="user-sub">Last response {fmtWhen(f.lastAt)}</small>}</td>
                        <td data-label="Status"><span className={`pill ${s.tone}`}>{s.label}</span></td>
                        <td className="muted" data-label="Open">{fmtWhen(f.startAt)}<br />to {fmtWhen(f.endAt)}</td>
                        <td data-label="Jamaats filled" className="st-mini">
                          <span><b>{f.jamaatsFilled}</b> / {f.jamaats}</span>
                          <span className="st-bar"><span style={{ width: `${f.jamaats ? Math.round((f.jamaatsFilled / f.jamaats) * 100) : 0}%` }} /></span>
                        </td>
                        <td data-label="Responses"><b>{f.responses}</b>{f.testResponses ? <small className="user-sub">+ {f.testResponses} test</small> : null}</td>
                        <td className="row-actions"><button type="button" className="mini-btn primary" onClick={() => openForm(f.id)}>Open</button></td>
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
            {data && <p className="page-sub">{plural(data.total, "response")}{filter.test ? " (test)" : ""} · times in your time{myZone() ? ` (${myZone()})` : ""}</p>}</div>
          {data && tab === "responses" && <button type="button" className="btn btn-primary" disabled={!data.total} onClick={() => resultsExcel(code, filter).catch(fail)}><DownloadIcon /> <span>Download Excel</span></button>}
        </section>
        {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}
        <div className="cp-tabs rs-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "status"} className={tab === "status" ? "is-on" : ""} onClick={() => setTab("status")}><UsersIcon /> Jamaat status</button>
          <button type="button" role="tab" aria-selected={tab === "responses"} className={tab === "responses" ? "is-on" : ""} onClick={() => setTab("responses")}><EyeIcon /> Responses {data && <span className="cp-count">{data.total}</span>}</button>
        </div>
        {tab === "status" && <StatusView code={code} isJc={isJc} fail={fail} onShowResponses={showResponses} />}
        {tab === "responses" && data && (
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
                  <thead><tr><th className="rs-view-col">View</th><th>#</th><th>Submitted</th><th>Jamiat</th><th>Jamaat</th><th>Filled by</th>
                    {cols.map((c) => <th key={c.key} title={c.label}>{c.label}{c.hidden ? <small className="muted"> (removed)</small> : null}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="rs-row" onClick={(e) => { if (!e.target.closest("a, button")) setOpen(i); }}>
                        <td className="rs-view-col"><button type="button" className="mini-btn primary" onClick={() => setOpen(i)} aria-label={`View response ${i + 1}`}><EyeIcon /> <span>View</span></button></td>
                        <td className="idx">{i + 1}</td>
                        <td className="rs-when">{fmtWhen(r.submittedAt)}{r.editedAt && <small className="user-sub">changed {fmtWhen(r.editedAt)}</small>}</td>
                        <td>{r.jamiat || <span className="muted">—</span>}</td>
                        <td><b>{r.jamaat || <span className="muted">—</span>}</b></td>
                        <td className="rs-who">{r.byJc
                          ? <><span className="pill info rs-jc-pill">Filled by JC</span><b>{r.byJc.name || r.byJc.email}</b><small>for {r.name || r.email || "the Jamaat"}</small></>
                          : <>{r.name && <b>{r.name}</b>}<small>{r.email}</small></>}</td>
                        {cols.map((c) => <td key={c.key}><Answer v={r.answers[c.key]} col={c} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {tab === "responses" && open != null && rows[open] && (
          <ResponseView form={data.form} row={rows[open]} n={open + 1} total={rows.length} onClose={() => setOpen(null)}
            onPrev={open > 0 ? () => setOpen(open - 1) : null} onNext={open < rows.length - 1 ? () => setOpen(open + 1) : null} />
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
