import { useCallback, useEffect, useRef, useState } from "react";
import Notice from "./components/Notice";
import { confirmDialog } from "./components/ConfirmDialog";
import { ChevronLeft, ChevronRight, DownloadIcon, TrashIcon, UploadIcon } from "./components/Icons";
import { AuthError, clearData, downloadData, fetchDataAdmin, previewData, saveDataChoices, uploadData } from "./lib/api";
import { colourStyle } from "./lib/dataColors";
import { plural } from "./lib/helpers";

const fmtWhen = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

// Super Admin › Data: upload the Excel file shown on the JC Portal's Data tab, pick the dropdown columns,
// and keep the one list of dropdown choices (with colours).
export default function DataAdmin({ onAuthExpired }) {
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState("");
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [opts, setOpts] = useState({});
  const fileRef = useRef(null);
  const seq = useRef(0);

  const fail = useCallback((err, what) => {
    if (err instanceof AuthError) return onAuthExpired();
    setMsg({ type: "error", text: `${what}: ${err.message}` });
  }, [onAuthExpired]);

  const load = useCallback(async () => {
    try { setInfo(await fetchDataAdmin()); } catch (err) { fail(err, "Could not load"); }
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  // Preview again whenever the file or the options change (the last answer wins).
  const preview = useCallback(async (f, o) => {
    const n = ++seq.current;
    setBusy("preview");
    try {
      const p = await previewData(f, o);
      if (n !== seq.current) return;
      setPlan(p);
      setOpts({ jamiatCol: p.jamiatCol, jamaatCol: p.jamaatCol, dropdown: p.columns.filter((c) => c.dropdown).map((c) => c.name) });
    } catch (err) {
      if (n !== seq.current) return;
      setPlan(null);
      fail(err, "Could not read the file");
    } finally {
      if (n === seq.current) setBusy("");
    }
  }, [fail]);

  const pick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setMsg({ type: "error", text: "The file is larger than 10 MB." });
    setMsg(null);
    setFile(f);
    setPlan(null);
    preview(f, {});
  };
  const change = (next) => { const o = { ...opts, ...next }; setOpts(o); preview(file, o); };
  const toggleDrop = (name, on) => change({ dropdown: on ? [...opts.dropdown, name] : opts.dropdown.filter((n) => n !== name) });
  const cancel = () => { seq.current++; setFile(null); setPlan(null); setBusy(""); };

  const save = async () => {
    const s = plan.stats;
    const lines = [`${plural(s.matched, "row")} for ${plural(s.jamaats, "Jamaat")} in ${plural(s.jamiats, "Jamiat")} will be shown to their JCs.`];
    if (s.unmatched) lines.push(`${plural(s.unmatched, "row")} that don't match a Jamiat and Jamaat in Masters will be left out.`);
    if (s.hadData) lines.push(`This replaces the current data. ${plural(s.kept, "row")} are the same as before and keep their statuses; ${plural(s.added, "new row")}${s.removed ? `; ${plural(s.removed, "row")} no longer in the file will be removed` : ""}.`);
    if (!(await confirmDialog({ tone: s.removed ? "warn" : "info", title: `Upload ${file.name}?`, confirmText: "Upload", message: lines }))) return;
    setBusy("upload");
    try {
      const r = await uploadData(file, opts);
      setInfo((i) => ({ ...i, ...r.config }));
      setMsg({ type: "ok", text: `Uploaded ${file.name}: ${plural(r.stats.matched, "row")} are now on the JC Portal's Data tab.` });
      setFile(null);
      setPlan(null);
      load();
    } catch (err) {
      fail(err, "Not uploaded");
    } finally {
      setBusy("");
    }
  };

  const clear = async () => {
    if (!(await confirmDialog({
      tone: "danger", title: "Remove the uploaded data?", confirmText: "Remove data",
      message: [`All ${plural(info.rowCount, "row")} and the statuses JCs chose will be removed. JCs will see an empty Data tab.`, "The dropdown choices are kept. This can't be undone."],
    }))) return;
    setBusy("clear");
    try {
      const r = await clearData();
      setInfo((i) => ({ ...i, ...r, counts: { jamiats: 0, jamaats: 0, picked: 0 } }));
      setMsg({ type: "ok", text: "The data was removed." });
    } catch (err) { fail(err, "Not removed"); } finally { setBusy(""); }
  };

  const download = async () => {
    setBusy("download");
    try { await downloadData(); } catch (err) { fail(err, "Could not download"); } finally { setBusy(""); }
  };

  return (
    <>
      <section className="page-head">
        <div className="page-title">
          <h1>Data</h1>
          <p className="page-sub">Upload an Excel file to show on the JC Portal's Data tab. Its first row gives the columns; each JC sees only their own Jamaats' rows.</p>
        </div>
      </section>

      {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}

      {!info ? <div className="panel portal-empty">Loading…</div> : (
        <div className="data-admin">
          {/* ---- Current data ---- */}
          <section className="panel data-card">
            <div className="panel-head"><div><h2>Current data</h2>
              <p>{info.hasData ? <>{info.fileName || "Excel file"} · uploaded {fmtWhen(info.uploadedAt)}{info.uploadedBy ? ` by ${info.uploadedBy}` : ""}</> : "Nothing has been uploaded yet."}</p></div></div>
            {info.hasData && (
              <>
                <div className="data-stats">
                  <div><b>{info.rowCount}</b><span>rows</span></div>
                  <div><b>{info.counts.jamiats}</b><span>Jamiats</span></div>
                  <div><b>{info.counts.jamaats}</b><span>Jamaats</span></div>
                  <div><b>{info.counts.picked}</b><span>rows with a status set</span></div>
                </div>
                <div className="data-cols">
                  {info.columns.map((c, i) => (
                    <span key={i} className={`col-chip${c.dropdown ? " is-drop" : ""}`}>
                      {c.name}{i === info.jamiatCol ? " · Jamiat" : i === info.jamaatCol ? " · Jamaat" : c.dropdown ? " · + status" : ""}
                    </span>
                  ))}
                </div>
                <div className="data-actions">
                  <button type="button" className={`btn btn-ghost${busy === "download" ? " loading" : ""}`} onClick={download} disabled={!!busy}><DownloadIcon /><span>Download Excel</span></button>
                  <button type="button" className="btn btn-danger-ghost" onClick={clear} disabled={!!busy}><TrashIcon /><span>Remove data</span></button>
                </div>
              </>
            )}
          </section>

          {/* ---- Upload ---- */}
          <section className="panel data-card">
            <div className="panel-head"><div><h2>{info.hasData ? "Upload a new file" : "Upload a file"}</h2>
              <p>Excel (.xlsx), up to 10 MB. It needs a Jamiat column and a Jamaat column with the names used in Masters.{info.hasData ? " Rows that are the same as now (in any order) keep the statuses JCs chose." : ""}</p></div></div>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={pick} />
            {!file ? (
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current.click()}><UploadIcon /><span>Choose Excel file</span></button>
            ) : (
              <UploadPreview file={file} plan={plan} opts={opts} busy={busy} onChange={change} onToggle={toggleDrop}
                onSave={save} onCancel={cancel} onOther={() => fileRef.current.click()} />
            )}
          </section>

          {/* ---- Choices ---- */}
          <Choices info={info} onSaved={(r) => setInfo((i) => ({ ...i, ...r }))} onMsg={setMsg} onFail={fail} />
        </div>
      )}
    </>
  );
}

function UploadPreview({ file, plan, opts, busy, onChange, onToggle, onSave, onCancel, onOther }) {
  const [showAll, setShowAll] = useState(false);
  if (!plan) return <p className="muted">{busy === "preview" ? `Reading ${file.name}…` : ""}</p>;
  const s = plan.stats;
  const headSel = (label, key) => (
    <label className="field">
      <span className="field-label">{label} column</span>
      <select value={opts[key] ?? -1} onChange={(e) => onChange({ [key]: Number(e.target.value) })}>
        <option value={-1}>Choose…</option>
        {plan.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
      </select>
    </label>
  );
  const unmatched = showAll ? plan.unmatched : plan.unmatched.slice(0, 10);
  return (
    <div className={`data-preview${busy === "preview" ? " is-busy" : ""}`}>
      <p className="data-file"><b>{file.name}</b> · sheet “{plan.sheet}” · <button type="button" className="link-btn" onClick={onOther}>choose another file</button></p>
      <div className="data-headsel">{headSel("Jamiat", "jamiatCol")}{headSel("Jamaat", "jamaatCol")}</div>

      {plan.needCols ? (
        <Notice type="error" text="Choose which columns hold the Jamiat and the Jamaat (they must be two different columns)." />
      ) : (
        <>
          <div className={`data-summary${s.matched ? "" : " is-bad"}`}>
            <p><b>{s.matched} of {plural(s.read, "row")}</b> match a Jamiat and Jamaat in Masters ({plural(s.jamiats, "Jamiat")}, {plural(s.jamaats, "Jamaat")}).</p>
            {s.hadData && <p>Compared with the current data: <b>{s.kept}</b> same (keep their statuses) · <b>{s.added}</b> new · <b>{s.removed}</b> to be removed.</p>}
            {s.hadData && s.compared.length > 0 && <p className="muted">“Same” = same Jamaat and same {s.compared.join(", ")}.</p>}
            {s.filePicks > 0 && <p className="muted">{plural(s.filePicks, "status", "statuses")} read from the cell colours in the file{s.hadData ? " (a status already chosen on the portal is kept)" : ""}.</p>}
          </div>

          <h3 className="data-sub">Columns <span className="muted">· tick the ones that get a status dropdown (the Excel value stays as it is)</span></h3>
          <div className="data-scroll">
            <table className="data-table compact">
              <thead><tr><th>Column</th><th>Status dropdown</th><th>Example</th></tr></thead>
              <tbody>
                {plan.columns.map((c, i) => {
                  const fixed = i === plan.jamiatCol || i === plan.jamaatCol;
                  const ex = (plan.sample.find((r) => r[i]) || [])[i] || "";
                  return (
                    <tr key={i}>
                      <td><b>{c.name}</b>{fixed && <span className="muted"> · {i === plan.jamiatCol ? "Jamiat" : "Jamaat"}</span>}</td>
                      <td><label className="check"><input type="checkbox" checked={c.dropdown} disabled={fixed || busy === "preview"} onChange={(e) => onToggle(c.name, e.target.checked)} /> {c.dropdown ? "Yes" : "No"}</label></td>
                      <td className="muted ex">{ex}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {plan.unmatched.length > 0 && (
            <>
              <h3 className="data-sub">Rows left out <span className="muted">· {s.unmatched}</span></h3>
              <div className="data-scroll">
                <table className="data-table compact">
                  <thead><tr><th>Excel row</th><th>Jamiat</th><th>Jamaat</th><th>Why</th></tr></thead>
                  <tbody>{unmatched.map((u) => <tr key={u.line}><td>{u.line}</td><td>{u.jamiat}</td><td>{u.jamaat}</td><td>{u.reason}</td></tr>)}</tbody>
                </table>
              </div>
              {plan.unmatched.length > 10 && <button type="button" className="link-btn" onClick={() => setShowAll((x) => !x)}>{showAll ? "Show fewer" : `Show all ${plan.unmatched.length}${s.unmatched > plan.unmatched.length ? " (first 300)" : ""}`}</button>}
            </>
          )}
        </>
      )}

      <div className="data-actions">
        <button type="button" className={`btn btn-primary${busy === "upload" ? " loading" : ""}`} onClick={onSave} disabled={!!busy || plan.needCols || !s || !s.matched}>
          <UploadIcon /><span>Upload</span>
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy === "upload"}>Cancel</button>
      </div>
    </div>
  );
}

let tmpId = 0;
function Choices({ info, onSaved, onMsg, onFail }) {
  const fromInfo = useCallback(() => info.choices.map((c) => ({ ...c, key: c.id })), [info.choices]);
  const [list, setList] = useState(fromInfo);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setList(fromInfo()); }, [fromInfo]);
  // Colours offered for a new choice (any colour can then be picked).
  const STARTERS = ["#8fd19e", "#f4a3a3", "#9ec5f0", "#f7d774", "#f8b98a", "#c9b3f2", "#f3abcf", "#8fd8d2", "#c9ced6"];
  const dirty = JSON.stringify(list.map(({ id, value, color }) => [id, value, color])) !== JSON.stringify(info.choices.map(({ id, value, color }) => [id, value, color]));

  const set = (k, patch) => setList((l) => l.map((c) => (c.key === k ? { ...c, ...patch } : c)));
  const move = (n, d) => setList((l) => { const a = [...l]; [a[n], a[n + d]] = [a[n + d], a[n]]; return a; });
  const add = () => {
    const used = new Set(list.map((c) => c.color.toLowerCase()));
    const color = STARTERS.find((k) => !used.has(k)) || `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;
    setList((l) => [...l, { key: `new${++tmpId}`, id: "", value: "", color }]);
  };

  const save = async () => {
    const gone = info.choices.filter((c) => !list.some((x) => x.id === c.id));
    if (gone.length && info.hasData && !(await confirmDialog({
      tone: "warn", title: `Remove ${gone.map((c) => c.value).join(", ")}?`, confirmText: "Remove",
      message: `Cells that have ${gone.length === 1 ? "this choice" : "these choices"} will become empty ("Not set").`,
    }))) return;
    setSaving(true);
    try {
      const r = await saveDataChoices(list.map(({ id, value, color }) => ({ id, value, color })));
      onSaved(r);
      onMsg({ type: "ok", text: `Choices saved.${r.changedCells ? ` ${plural(r.changedCells, "row")} updated.` : ""}` });
    } catch (err) { onFail(err, "Choices not saved"); } finally { setSaving(false); }
  };

  return (
    <section className="panel data-card">
      <div className="panel-head"><div><h2>Dropdown choices</h2>
        <p>One list for every status dropdown. Pick any colour: it is shown on the Data tab and as the cell's background in the downloaded Excel (so each choice needs its own colour). Renaming a choice renames it in the data too.</p></div></div>
      <div className="choice-list">
        {list.map((c, n) => (
          <div key={c.key} className="choice-row">
            <span className="dchip has" style={colourStyle(c.color)}>{c.value || "New choice"}</span>
            <input className="input" value={c.value} maxLength={30} placeholder="Choice name" aria-label={`Choice ${n + 1} name`} onChange={(e) => set(c.key, { value: e.target.value })} />
            <label className="color-pick" title="Pick a colour">
              <input type="color" value={c.color} onChange={(e) => set(c.key, { color: e.target.value.toLowerCase() })} aria-label={`Colour of ${c.value || "choice " + (n + 1)}`} />
              <span className="color-code">{c.color.toUpperCase()}</span>
              <span className="muted">Change colour</span>
            </label>
            <div className="choice-btns">
              <button type="button" className="icon-btn" disabled={n === 0} onClick={() => move(n, -1)} title="Move up" aria-label="Move up"><span className="rot"><ChevronLeft /></span></button>
              <button type="button" className="icon-btn" disabled={n === list.length - 1} onClick={() => move(n, 1)} title="Move down" aria-label="Move down"><span className="rot"><ChevronRight /></span></button>
              <button type="button" className="icon-btn" disabled={list.length === 1} onClick={() => setList((l) => l.filter((x) => x.key !== c.key))} title="Remove" aria-label={`Remove ${c.value}`}><TrashIcon /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="data-actions">
        <button type="button" className="btn btn-ghost" onClick={add} disabled={list.length >= 20}>Add choice</button>
        <button type="button" className={`btn btn-primary${saving ? " loading" : ""}`} onClick={save} disabled={!dirty || saving}>Save choices</button>
        {dirty && <button type="button" className="link-btn" onClick={() => setList(fromInfo())}>Undo changes</button>}
      </div>
    </section>
  );
}
