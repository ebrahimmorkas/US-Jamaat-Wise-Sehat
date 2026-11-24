import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { confirmDialog } from "./components/ConfirmDialog";
import { ImageIcon, ReportIcon } from "./components/Icons";
import {
  AuthError, isServerStarting, reportFormats, reportFormatAdd, reportFormatSave, reportFormatReplace, reportFormatDelete,
  reportFormatFile, reportFormatSample, reportForms, reportPhotos, reportSetCount, reportPick, reportPhotoFile, reportHeading, reportDescription,
  reportGenerate, reportJob, reportJobFile, reportHistory,
} from "./lib/api";
import { lower, plural } from "./lib/helpers";

// Reports (PDF) made from the photos Jamaat Coordinators uploaded in a form.
//   Generate:       pick the form and the format -> photo report + list of Jamaats not filled (a JC gets only
//                   their Jamaats; Media gets no "not filled" list). Reports made earlier are listed to make again.
//   Choose photos:  Media / Super Admin: how many photos per Jamaat, and which ones (else the first ones); the
//                   report's title and date and each Jamaat's description (Arabic, typed in the Al-Kanz font).
//   Formats:        Super Admin uploads the one-page PDF: "Image" boxes, "Jamiat" and "Jamaat" words
//                   (+ optional "Title", "Date" and a box with "Description").

export const MEDIA_NAV = [
  { to: "/media/photos", label: "Choose photos", icon: <ImageIcon /> },
  { to: "/media/reports", label: "Reports", icon: <ReportIcon /> },
];

const TAB_LABEL = { generate: "Generate report", photos: "Choose photos", formats: "Formats" };
const SUB = {
  generate: "Choose a form and a format, then Generate: the format's page is repeated with each Jamaat's name and photos (Jamiat, then Jamaat A–Z). You also get a separate list of the Jamaats that haven't filled the form.",
  photos: "Type the report's title and date, then choose which photos of each Jamaat go in the report and write its description. First type how many photos each Jamaat gets; a Jamaat you don't choose for gets its first photos.",
  formats: "Upload the report's page as a one-page PDF: borders, background, a box with the word Image where each photo goes, and the words Jamiat and Jamaat where the names go. The page is repeated to make the report.",
};
const SUB_MEDIA = "Choose a form and a format, then Generate: the format's page is repeated with each Jamaat's name and photos (Jamiat, then Jamaat A–Z).";
const STATE = { open: "Open", not_started: "Not started", closed: "Closed" };
const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function Reports({ embedded, nav, page, only, user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const role = user ? user.role : "superadmin";
  const tabs = only ? [only] : ["generate", ...(role === "superadmin" || role === "media" ? ["photos"] : []), ...(role === "superadmin" ? ["formats"] : [])];
  const [tab, setTab] = useState(tabs[0]);
  const [msg, setMsg] = useState(null);
  const fail = useCallback((err) => {
    if (err instanceof AuthError) return onAuthExpired();
    setMsg({ type: "error", text: err.message });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [onAuthExpired]);
  const failRef = useRef(fail);
  failRef.current = fail;

  const [forms, setForms] = useState(null);
  const [formats, setFormats] = useState(null);
  const [maxMb, setMaxMb] = useState(12);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const load = useCallback(async (tries = 0) => {
    try {
      const [a, b] = await Promise.all([reportForms(), reportFormats()]);
      setForms(a.forms); setFormats(b.formats); setMaxMb(b.maxMb || 12);
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) { setLoadMsg("Connecting to the server…"); setTimeout(() => load(tries + 1), 5000); }
      else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);
  const reloadFormats = useCallback(() => reportFormats().then((b) => setFormats(b.formats)).catch((e) => failRef.current(e)), []);

  const go = (k) => { setTab(k); setMsg(null); };
  const body = (
    <div className="rp-page">
      <section className="page-head"><div className="page-title"><h1>{only ? TAB_LABEL[only] : "Reports"}</h1>
        <p className="page-sub">{tab === "generate" && role === "media" ? SUB_MEDIA : SUB[tab]}</p></div></section>
      {tabs.length > 1 && (
        <div className="cp-tabs" role="tablist">
          {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => go(k)}>{TAB_LABEL[k]}</button>)}
        </div>
      )}
      <Notice type={msg && msg.type} text={msg && msg.text} onClose={() => setMsg(null)} />
      {!forms || !formats ? <div className="panel em-loading">{loadMsg}</div> : <>
        {tab === "generate" && <Generate forms={forms} formats={formats} role={role} fail={fail} />}
        {tab === "photos" && <ChoosePhotos forms={forms} fail={fail} setMsg={setMsg} onCount={load} />}
        {tab === "formats" && <Formats formats={formats} reload={reloadFormats} maxMb={maxMb} fail={fail} setMsg={setMsg} />}
      </>}
    </div>
  );
  if (embedded) return body;
  return (
    <>
      <AppBar title={role === "media" ? "Media" : undefined} subtitle={role === "media" ? "Umoor Sehhat" : undefined}
        nav={nav} page={page} theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container">{body}</main>
    </>
  );
}

const formLabel = (f) => `${f.title}${f.status === "testing" ? " (Testing)" : f.state && f.state !== "open" ? ` (${STATE[f.state] || f.state})` : ""}`;

// ---------- Generate ----------
function Generate({ forms, formats, role, fail }) {
  const [form, setForm] = useState(forms.length === 1 ? forms[0].code : "");
  const [format, setFormat] = useState(formats.length === 1 ? formats[0].id : "");
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(""); // the report's file name; "" until typed = the default below
  const [typed, setTyped] = useState(false);
  const running = job && (job.status === "queued" || job.status === "running");
  const fmt = formats.find((f) => f.id === format);
  const fm = forms.find((f) => f.code === form);
  const defaultName = fm ? `${fm.title} – Report – ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "";
  const fileName = typed ? name : defaultName;
  const media = role === "media";

  // reports generated earlier (listed below, to download again while kept or make again)
  const [history, setHistory] = useState(null);
  const failRef = useRef(fail);
  failRef.current = fail;
  const loadHistory = useCallback(() => reportHistory().then((r) => setHistory(r.reports)).catch((e) => failRef.current(e)), []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (!running) return undefined;
    const t = setTimeout(() => reportJob(job.id).then((r) => { setJob(r.job); if (r.job.status === "done") loadHistory(); }).catch((e) => { setJob(null); fail(e); }), 1500);
    return () => clearTimeout(t);
  }, [job, running, fail, loadHistory]);

  const run = async (f, fm, n) => {
    setBusy(true);
    try { setJob((await reportGenerate(f, fm, n)).job); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const start = () => run(form, format, fileName.trim() || defaultName);
  const save = async (which, id = job.id) => { try { await reportJobFile(id, which); } catch (e) { fail(e); } };
  // the same report again: same form, format and file name
  const [extraFmt, setExtraFmt] = useState(null); // a format chosen from the list below that the menu can't name
  const again = (h) => {
    // page ids change on every load: find the format in the menu by its name
    const same = formats.filter((x) => x.name === h.formatName);
    setForm(h.form); setFormat(same.length === 1 ? same[0].id : h.format);
    setExtraFmt(same.length === 1 ? null : { id: h.format, name: h.formatName });
    setTyped(!!h.name); setName(h.name);
    const f = forms.find((x) => x.code === h.form);
    const dflt = f ? `${f.title} – Report – ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "";
    run(h.form, h.format, h.name || dflt);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!forms.length) return <div className="panel em-loading">No form with a photo question has been published yet.</div>;
  return (
    <section className="panel rp-gen">
      <div className="rp-gen-row">
        <label className="field rp-field"><span className="field-label">Form</span>
          <select className="input" value={form} onChange={(e) => { setForm(e.target.value); setJob(null); setTyped(false); setName(""); }} disabled={running}>
            <option value="">Choose a form…</option>
            {forms.map((f) => <option key={f.code} value={f.code}>{formLabel(f)}</option>)}
          </select>
        </label>
        <label className="field rp-field"><span className="field-label">Format</span>
          <select className="input" value={format} onChange={(e) => { setFormat(e.target.value); setJob(null); }} disabled={running || !formats.length}>
            <option value="">{formats.length ? "Choose a format…" : "No format yet"}</option>
            {formats.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            {extraFmt && extraFmt.id === format && <option value={extraFmt.id}>{extraFmt.name}</option>}
          </select>
        </label>
        <button type="button" className="btn btn-primary rp-go" disabled={!form || !format || running || busy} onClick={start}>
          {busy || running ? "Generating…" : "Generate"}
        </button>
      </div>
      {fm && (
        <label className="field rp-name"><span className="field-label">Report file name</span>
          <span className="rp-name-row">
            <input className="input" value={fileName} maxLength={120} disabled={running} onChange={(e) => { setTyped(true); setName(e.target.value); }} />
            <span className="rp-ext">.pdf</span>
            {typed && fileName !== defaultName && <button type="button" className="btn btn-ghost btn-sm" disabled={running} onClick={() => { setTyped(false); setName(""); }}>Use default</button>}
          </span>
        </label>
      )}
      {!formats.length && <p className="field-hint">{role === "superadmin" ? "Upload a format first (Formats tab)." : "The Super Admin hasn't uploaded a report format yet."}</p>}
      {fmt && <p className="field-hint rp-fmt-sum">{fmt.summary}{fm ? ` Photos per Jamaat for this form: ${fm.photosPerJamaat}${fm.photosPerJamaat > fmt.photos ? ` (the format has ${fmt.photos} — extra photos are left out)` : ""}.` : ""}</p>}
      {role === "jc" && <p className="field-hint">Only your Jamaats are in the report.</p>}

      {job && (
        <div className={`rp-job rp-job-${job.status}`} aria-live="polite">
          {running && <>
            <div className="rp-step">{job.step}…</div>
            <div className="rp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={job.total || 1} aria-valuenow={job.done}>
              <span style={{ width: `${job.total ? Math.round((job.done / job.total) * 100) : 5}%` }} />
            </div>
          </>}
          {job.status === "failed" && <Notice type="error" text={job.error} />}
          {job.status === "done" && <>
            <div className="rp-done-title">Report ready: {job.form}</div>
            <ul className="rp-facts">
              <li>{plural(job.jamaats, "Jamaat")} · {plural(job.photos, "photo")}{job.files.photos ? ` · ${plural(job.files.photos.pages, "page")}` : ""}</li>
              {job.notFilled != null && <li>{plural(job.notFilled, "Jamaat")} not filled{job.noPhoto ? ` · ${plural(job.noPhoto, "Jamaat")} filled without a photo` : ""}</li>}
              {job.failed > 0 && <li className="rp-warn">{plural(job.failed, "photo")} couldn't be loaded and {job.failed === 1 ? "was" : "were"} left out. Generate again to retry.</li>}
            </ul>
            <div className="rp-dl">
              {job.files.photos
                ? <button type="button" className="btn btn-primary" onClick={() => save("photos")}>Download report ({sizeText(job.files.photos.size)})</button>
                : <span className="field-hint">No photos to put in a report yet.</span>}
              {job.files.notFilled && <button type="button" className="btn btn-ghost" onClick={() => save("not-filled")}>Download “not filled” list</button>}
            </div>
            <p className="field-hint">The files can be downloaded for 2 hours. After that, use Generate again below.</p>
          </>}
        </div>
      )}

      <div className="rp-hist">
        <h2>Generated reports</h2>
        {!history ? <p className="field-hint">Loading…</p> : !history.length ? <p className="field-hint">Reports you generate are listed here, so you can make the same report again.</p> : (
          <ul className="rp-hist-list">
            {history.map((h) => {
              const ok = h.form && h.format;
              return (
                <li key={h.id} className="rp-hist-item">
                  <div className="rp-hist-main">
                    <b className="rp-hist-name">{h.fileName || `${h.formTitle} (no photos)`}</b>
                    <span className="rp-hist-meta">{h.formTitle} · {h.formatName} · {fmtAt(h.at)}{h.pages ? ` · ${plural(h.pages, "page")}` : ""}{h.by ? ` · by ${h.by}` : ""}</span>
                    {!ok && <span className="rp-hist-meta rp-warn">{!h.form ? "The form isn't available any more." : "The format was deleted."}</span>}
                  </div>
                  <div className="rp-hist-act">
                    {h.job && h.job.files.includes("photos") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => save("photos", h.job.id)}>Download</button>}
                    {!media && h.job && h.job.files.includes("notFilled") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => save("not-filled", h.job.id)}>Not filled list</button>}
                    <button type="button" className="btn btn-primary btn-sm" disabled={!ok || running || busy} onClick={() => again(h)}>Generate again</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
const fmtAt = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

// ---------- Choose photos ----------
const PAGE = 30;
function ChoosePhotos({ forms, fail, setMsg, onCount }) {
  const [code, setCode] = useState(forms.length === 1 ? forms[0].code : "");
  const [data, setData] = useState(null);
  const [count, setCount] = useState("");
  const [jamiat, setJamiat] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const failRef = useRef(fail);
  failRef.current = fail;

  const load = useCallback((c) => reportPhotos(c).then((r) => { setData(r); setCount(String(r.form.photosPerJamaat)); }).catch((e) => failRef.current(e)), []);
  useEffect(() => { setData(null); setLimit(PAGE); if (code) load(code); }, [code, load]);

  const saveCount = async () => {
    try {
      const n = Number(count);
      await reportSetCount(code, n);
      setMsg({ type: "ok", text: `Each Jamaat gets ${plural(n, "photo")} in the report.` });
      await load(code);
      onCount();
    } catch (e) { fail(e); }
  };

  const jamiats = useMemo(() => (data ? [...new Set(data.jamaats.map((j) => j.jamiat))] : []), [data]);
  const shown = useMemo(() => (!data ? [] : data.jamaats.filter((j) =>
    (!jamiat || j.jamiat === jamiat) && (!q || lower(j.name).includes(lower(q)))
    && (!show || (show === "chosen" ? j.picked : !j.picked)))), [data, jamiat, q, show]);

  if (!forms.length) return <div className="panel em-loading">No form with a photo question has been published yet.</div>;
  const per = data ? data.form.photosPerJamaat : 0;
  const countChanged = data && count !== String(per);
  return (
    <>
      <section className="panel rp-choose-head">
        <label className="field rp-field"><span className="field-label">Form</span>
          <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">Choose a form…</option>
            {forms.map((f) => <option key={f.code} value={f.code}>{formLabel(f)}</option>)}
          </select>
        </label>
        {data && (
          <div className="rp-count">
            <label className="field rp-count-field"><span className="field-label">Photos per Jamaat</span>
              <input className="input" type="number" min={1} max={10} step={1} inputMode="numeric" value={count}
                onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
            </label>
            <button type="button" className="btn btn-primary" disabled={!countChanged || !count} onClick={saveCount}>Save</button>
          </div>
        )}
      </section>
      {code && !data && <div className="panel em-loading">Loading photos…</div>}
      {data && <ReportHeading key={code} code={code} form={data.form} fail={fail} setMsg={setMsg} onSaved={() => load(code)} />}
      {data && (
        <>
          <p className="rp-meta">
            {plural(data.jamaats.length, "Jamaat")} filled the form · {data.jamaats.filter((j) => j.picked).length} chosen by Media{data.notFilled != null ? ` · ${plural(data.notFilled, "Jamaat")} not filled` : ""}
          </p>
          {data.jamaats.length > 0 && (
            <div className="rp-filters">
              <select className="input" value={jamiat} onChange={(e) => { setJamiat(e.target.value); setLimit(PAGE); }} aria-label="Jamiat">
                <option value="">All Jamiats</option>
                {jamiats.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
              <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search Jamaat" aria-label="Search Jamaat" />
              <select className="input" value={show} onChange={(e) => { setShow(e.target.value); setLimit(PAGE); }} aria-label="Show">
                <option value="">All</option>
                <option value="todo">Not chosen yet</option>
                <option value="chosen">Chosen</option>
              </select>
            </div>
          )}
          {!data.jamaats.length && <div className="panel em-loading">No Jamaat has filled this form yet.</div>}
          {shown.slice(0, limit).map((j) => <JamaatPhotos key={j.id} j={j} code={code} per={per} fail={fail} onSaved={() => load(code)} />)}
          {data.jamaats.length > 0 && !shown.length && <div className="panel em-loading">No Jamaat matches.</div>}
          {shown.length > limit && <button type="button" className="btn btn-ghost rp-more" onClick={() => setLimit(limit + PAGE)}>Show more ({shown.length - limit} more)</button>}
        </>
      )}
    </>
  );
}

// The report's title and date (Arabic): printed at the top of every page where the format has "Title" / "Date".
function ReportHeading({ code, form, fail, setMsg, onSaved }) {
  const [title, setTitle] = useState(form.reportTitle || "");
  const [date, setDate] = useState(form.reportDate || "");
  const [busy, setBusy] = useState(false);
  const dirty = title.trim() !== (form.reportTitle || "") || date.trim() !== (form.reportDate || "");
  const save = async () => {
    setBusy(true);
    try {
      await reportHeading(code, title, date);
      setMsg({ type: "ok", text: "Title and date saved." });
      await onSaved();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <section className="panel rp-heading">
      <h2>Report title and date</h2>
      <p className="field-hint">In Arabic. Printed at the top of every page (where the format has the words Title and Date).</p>
      <div className="rp-heading-row">
        <label className="field"><span className="field-label">Title</span>
          <input className="input kanz-input" dir="rtl" lang="ar" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Report title" />
        </label>
        <label className="field"><span className="field-label">Date</span>
          <input className="input kanz-input" dir="rtl" lang="ar" maxLength={80} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Report date" />
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save" : "Saved"}</button>
      </div>
    </section>
  );
}

// A Jamaat's description (Arabic): printed in its "Description" box in the report.
function JamaatDescription({ j, code, fail, onSaved }) {
  const [text, setText] = useState(j.description || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(j.description || ""); }, [j.description]);
  const dirty = text.trim() !== (j.description || "");
  const save = async () => {
    setBusy(true);
    try { await reportDescription(code, j.id, text); await onSaved(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <div className="rp-desc">
      <label className="field"><span className="field-label">Description (Arabic)</span>
        <textarea className="input kanz-input" dir="rtl" lang="ar" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Description for ${j.name}`} />
      </label>
      <div className="rp-desc-foot">
        <span className="field-hint">{text.length ? `${text.length} / 1000` : "No description"}</span>
        {dirty && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setText(j.description || "")}>Undo</button>}
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : dirty ? "Save description" : "Saved"}</button>
      </div>
    </div>
  );
}

function JamaatPhotos({ j, code, per, fail, onSaved }) {
  const start = useMemo(() => j.chosen.filter((i) => i >= 0).slice(0, per), [j, per]);
  const [sel, setSel] = useState(start);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel(start); setNote(""); }, [start]);
  const dirty = sel.join(",") !== start.join(",");

  const toggle = (i) => {
    setNote("");
    if (sel.includes(i)) setSel(sel.filter((x) => x !== i));
    else if (sel.length >= per) setNote(`Only ${plural(per, "photo")} per Jamaat. Untick one first.`);
    else setSel([...sel, i]);
  };
  const save = async (photos) => {
    setBusy(true);
    try { await reportPick(code, j.id, photos); await onSaved(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const download = async (p) => { try { await reportPhotoFile(p.id); } catch (e) { fail(e); } };

  return (
    <section className="panel rp-jm">
      <div className="rp-jm-head">
        <div><b>{j.name}</b> <span className="rp-jt">{j.jamiat}</span></div>
        {j.picked
          ? <span className="pill good">Chosen{j.pickedBy ? ` by ${j.pickedBy}` : ""}</span>
          : <span className="pill na">Not chosen — first {plural(Math.min(per, j.photos.length), "photo")} used</span>}
      </div>
      <div className="rp-grid">
        {j.photos.map((p, i) => {
          const n = sel.indexOf(i);
          return (
            <div key={p.id} className={`rp-ph${n >= 0 ? " is-on" : ""}`}>
              <button type="button" className="rp-ph-pick" onClick={() => toggle(i)} aria-pressed={n >= 0}
                aria-label={`${n >= 0 ? "Remove" : "Use"} photo ${i + 1} (${p.name})`} title={`${p.field} · ${p.name}`}>
                <img src={p.thumb} alt="" loading="lazy" />
                {n >= 0 && <span className="rp-ph-n">{n + 1}</span>}
              </button>
              <div className="rp-ph-links">
                <a href={p.url} target="_blank" rel="noopener noreferrer">View</a>
                <button type="button" className="linklike" onClick={() => download(p)}>Download</button>
              </div>
            </div>
          );
        })}
      </div>
      {note && <p className="rp-note" role="status">{note}</p>}
      <div className="rp-jm-foot">
        <span className="field-hint">{sel.length ? `${plural(sel.length, "photo")} chosen (in this order)` : "No photo chosen: this Jamaat is left out of the report"}</span>
        {j.picked && !dirty && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save(null)}>Use first photos</button>}
        {dirty && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setSel(start); setNote(""); }}>Undo</button>}
        <button type="button" className="btn btn-primary" disabled={busy || (!dirty && j.picked)} onClick={() => save(sel.map((i) => j.photos[i].id))}>
          {busy ? "Saving…" : j.picked && !dirty ? "Saved" : "Save choice"}
        </button>
      </div>
      <JamaatDescription j={j} code={code} fail={fail} onSaved={onSaved} />
    </section>
  );
}

// ---------- Formats (Super Admin) ----------
function Formats({ formats, reload, maxMb, fail, setMsg }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const fileRef = useRef(null);

  const add = async () => {
    if (file.size > maxMb * 1048576) return fail(new Error(`The PDF is too large (largest ${maxMb} MB).`));
    setProgress(0);
    try {
      const r = await reportFormatAdd(name.trim(), file, setProgress);
      setMsg({ type: "ok", text: `Format “${r.format.name}” added: ${r.format.summary} Check it with “Sample PDF”.` });
      setName(""); setFile(null); if (fileRef.current) fileRef.current.value = "";
      await reload();
    } catch (e) { fail(e); } finally { setProgress(null); }
  };

  return (
    <>
      <section className="panel rp-help">
        <h2>How to make a format</h2>
        <ol>
          <li>Design <b>one page</b> (Canva, Word, …): borders, background, title — everything that stays the same.</li>
          <li>Draw a box where each photo goes and type the word <b>Image</b> inside it.</li>
          <li>Type <b>Jamaat</b> where a Jamaat's name goes and <b>Jamiat</b> where its Jamiat's name goes (on their own, nothing else in that text). <b>{"{{Jamaat}}"}</b> also works. Words in capitals (JAMAAT) are treated as labels and stay.</li>
          <li>Each <b>Jamaat</b> word is one Jamaat on the page: 3 rows with Jamaat = 3 Jamaats a page. The Image boxes next to it are its photos.</li>
          <li>Optional: type <b>Title</b> and <b>Date</b> where the report's title and date go (Media types them, in Arabic, on Choose photos), and draw a box with the word <b>Description</b> inside it next to each Jamaat for its description (it is written inside that box, on as many lines as needed).</li>
          <li>Save it as a PDF (text must stay text, not a picture) and upload it. Then check it with <b>Sample PDF</b>.</li>
        </ol>
        <p className="field-hint">Photos are shown whole (not cut), centred in their box, at the photo size you set. If a Jamaat has fewer photos than boxes, its photos are centred and the empty boxes are removed.</p>
      </section>

      <section className="panel rp-add">
        <h2>Add a format</h2>
        <div className="rp-add-row">
          <label className="field rp-field"><span className="field-label">Name</span>
            <input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly photo report" />
          </label>
          <label className="field rp-field"><span className="field-label">PDF (one page, up to {maxMb} MB)</span>
            <input ref={fileRef} className="input" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
          </label>
          <button type="button" className="btn btn-primary rp-go" disabled={!name.trim() || !file || progress !== null} onClick={add}>
            {progress !== null ? (progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Reading the PDF…") : "Upload"}
          </button>
        </div>
      </section>

      {!formats.length ? <div className="panel em-loading">No formats yet.</div>
        : formats.map((f) => <FormatCard key={f.id} f={f} reload={reload} maxMb={maxMb} fail={fail} setMsg={setMsg} />)}
    </>
  );
}

function FormatCard({ f, reload, maxMb, fail, setMsg }) {
  const [name, setName] = useState(f.name);
  const [w, setW] = useState(String(f.photoW || ""));
  const [h, setH] = useState(String(f.photoH || ""));
  const [busy, setBusy] = useState("");
  useEffect(() => { setName(f.name); setW(String(f.photoW || "")); setH(String(f.photoH || "")); }, [f]);
  const dirty = name.trim() !== f.name || w !== String(f.photoW || "") || h !== String(f.photoH || "");
  const run = async (what, fn) => { setBusy(what); try { await fn(); } catch (e) { fail(e); } finally { setBusy(""); } };

  const save = () => run("save", async () => {
    await reportFormatSave(f.id, { name: name.trim(), photoW: w, photoH: h });
    setMsg({ type: "ok", text: `Format “${name.trim()}” saved.` });
    await reload();
  });
  const replace = (file) => run("replace", async () => {
    if (!file) return;
    if (file.size > maxMb * 1048576) throw new Error(`The PDF is too large (largest ${maxMb} MB).`);
    const r = await reportFormatReplace(f.id, file);
    setMsg({ type: "ok", text: `New PDF for “${f.name}”: ${r.format.summary} The photo size was set from its first box — check it with “Sample PDF”.` });
    await reload();
  });
  const del = async () => {
    if (!(await confirmDialog({ title: "Delete this format?", message: `“${f.name}” can no longer be chosen when generating reports.`, confirmText: "Delete", tone: "danger" }))) return;
    run("delete", async () => { await reportFormatDelete(f.id); setMsg({ type: "ok", text: `Format “${f.name}” deleted.` }); await reload(); });
  };

  return (
    <section className="panel rp-fmt">
      <div className="rp-fmt-head">
        <div>
          <b className="rp-fmt-name">{f.name}</b>
          <div className="rp-fmt-sum">{f.summary}</div>
          <div className="field-hint">Page {f.page.w} × {f.page.h} mm · {f.fileName || "PDF"} ({sizeText(f.size)}) · changed by {f.updatedBy || "—"}</div>
        </div>
      </div>
      <div className="rp-fmt-edit">
        <label className="field rp-field"><span className="field-label">Name</span>
          <input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field rp-mm"><span className="field-label">Photo width (mm)</span>
          <input className="input" type="number" min={5} max={600} step="0.5" value={w} onChange={(e) => setW(e.target.value)} />
        </label>
        <label className="field rp-mm"><span className="field-label">Photo height (mm)</span>
          <input className="input" type="number" min={5} max={600} step="0.5" value={h} onChange={(e) => setH(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary rp-go" disabled={!dirty || !!busy || !name.trim()} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>
      {f.suggested && <p className="field-hint">The first Image box is about {f.suggested.w + 4} × {f.suggested.h + 4} mm. Each photo is fitted whole inside the photo size, centred in its box.</p>}
      <div className="rp-fmt-actions">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => run("sample", () => reportFormatSample(f.id, w, h))}>{busy === "sample" ? "Making…" : "Sample PDF"}</button>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => run("file", () => reportFormatFile(f.id))}>Download PDF</button>
        <label className={`btn btn-ghost${busy ? " is-disabled" : ""}`}>{busy === "replace" ? "Reading the PDF…" : "Replace PDF"}
          <input type="file" accept="application/pdf,.pdf" hidden disabled={!!busy} onChange={(e) => { const file = e.target.files[0]; e.target.value = ""; replace(file); }} />
        </label>
        <button type="button" className="btn btn-ghost rp-del" disabled={!!busy} onClick={del}>Delete</button>
      </div>
    </section>
  );
}
