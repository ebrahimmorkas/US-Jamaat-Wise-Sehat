import { useCallback, useEffect, useRef, useState } from "react";
import RichEditor from "./components/RichEditor";
import { confirmDialog } from "./components/ConfirmDialog";
import { AuthError, emailAttach, emailDropFile, emailPublic, emailRender, emailVariables, emailForms,
  templateList, templateGet, templateCreate, templateSave, templateDelete } from "./lib/api";
import { plural } from "./lib/helpers";
import { CloseIcon } from "./components/Icons";

// Email templates (Super Admin, Saheb) + pieces shared with "Write email":
//   useEmailMeta()   the variables, forms and templates (loaded once)
//   Attachments      attach files (private; sent with the email)
//   CopyFields       CC / BCC (any email address; they get ONE copy)
//   PreviewButton    the email exactly as one person gets it

export const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
const splitList = (s) => [...new Set(String(s || "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
const when = (d) => (d ? new Date(d).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export function useEmailMeta(fail) {
  const [meta, setMeta] = useState({ variables: [], forms: [], templates: [], contact: null, loaded: false });
  const reloadTemplates = useCallback(() => templateList().then((r) => setMeta((m) => ({ ...m, templates: r.templates }))).catch(fail), [fail]);
  useEffect(() => {
    let alive = true;
    Promise.all([emailVariables(), emailForms(), templateList()])
      .then(([v, f, t]) => alive && setMeta({ variables: v.variables, contact: v.contact, forms: f.forms, templates: t.templates, loaded: true }))
      .catch((e) => alive && fail(e));
    return () => { alive = false; };
  }, [fail]);
  return [meta, reloadTemplates];
}

/** Attachments: `kept` = files already saved (template), `files` = new uploads ({ key, id?, name, size, progress?, error? }). */
export function Attachments({ kept = [], onDropKept, files, setFiles, maxMb, onAuthExpired }) {
  const total = kept.reduce((n, f) => n + (f.size || 0), 0) + files.filter((f) => f.id).reduce((n, f) => n + f.size, 0);
  const add = async (list) => {
    let used = total;
    for (const file of list) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      if (used + file.size > maxMb * 1048576) {
        setFiles((x) => [...x, { key, name: file.name, size: file.size, error: `Too large: attachments up to ${maxMb} MB in total.` }]);
        continue;
      }
      used += file.size;
      setFiles((x) => [...x, { key, name: file.name, size: file.size, progress: 0 }]);
      try {
        const r = await emailAttach(file, (p) => setFiles((x) => x.map((f) => (f.key === key ? { ...f, progress: p } : f))));
        setFiles((x) => x.map((f) => (f.key === key ? { ...f, id: r.id } : f)));
      } catch (err) {
        if (err instanceof AuthError) return onAuthExpired();
        setFiles((x) => x.map((f) => (f.key === key ? { ...f, error: err.message } : f)));
      }
    }
  };
  const drop = (f) => { setFiles((x) => x.filter((y) => y.key !== f.key)); if (f.id) emailDropFile(f.id).catch(() => {}); };
  return (
    <div className="em-files">
      {kept.map((f, i) => (
        <div key={`k${i}`} className="em-file">
          <span className="em-file-name">{f.name}</span><small>{size(f.size)}</small>
          {onDropKept && <button type="button" className="em-x" onClick={() => onDropKept(i)} aria-label={`Remove ${f.name}`} title="Remove"><CloseIcon /></button>}
        </div>
      ))}
      {files.map((f) => (
        <div key={f.key} className={`em-file${f.error ? " is-bad" : ""}`}>
          <span className="em-file-name">{f.name}</span>
          <small>{f.error ? f.error : f.id ? size(f.size) : `Uploading ${Math.round((f.progress || 0) * 100)}%`}</small>
          <button type="button" className="em-x" onClick={() => drop(f)} aria-label={`Remove ${f.name}`} title="Remove"><CloseIcon /></button>
        </div>
      ))}
      <label className="btn btn-ghost em-attach">+ Attach files
        <input type="file" multiple hidden onChange={(e) => { add([...e.target.files]); e.target.value = ""; }} />
      </label>
      <small className="em-muted">up to {maxMb} MB in total</small>
    </div>
  );
}

export function CopyFields({ cc, setCc, bcc, setBcc }) {
  const [open, setOpen] = useState(!!(cc || bcc));
  useEffect(() => { if (cc || bcc) setOpen(true); }, [cc, bcc]);
  if (!open) return <button type="button" className="link-btn em-cc-open" onClick={() => setOpen(true)}>+ Add CC / BCC</button>;
  return (
    <div className="em-cc">
      <label className="em-label" htmlFor="em-cc">CC <small>(any email address; separate with commas)</small></label>
      <input id="em-cc" className="input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="e.g. office@example.com" />
      <label className="em-label" htmlFor="em-bcc">BCC <small>(hidden from the others)</small></label>
      <input id="em-bcc" className="input" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="e.g. records@example.com" />
      <p className="field-hint">CC and BCC get <b>one copy</b> of the email (not one per person), with the list of who it was sent to.</p>
    </div>
  );
}
export const toList = splitList;

/** "Preview" — the email as one person gets it (all variables filled), in a sandboxed frame. */
export function PreviewButton({ build, people = [], fail, label = "Preview" }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (user) => {
    setBusy(true);
    try { setR(await emailRender({ ...build(), user: user || undefined })); }
    catch (e) { setOpen(false); fail(e); }
    finally { setBusy(false); }
  }, [build, fail]);
  const start = () => { const u = who || (people[0] && people[0].user) || ""; setWho(u); setOpen(true); setR(null); run(u); };
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="btn btn-ghost em-prev-btn" onClick={start}>{label}</button>
      {open && (
        <div className="em-prev-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="em-prev" role="dialog" aria-modal="true" aria-label="Email preview">
            <div className="em-prev-head">
              <div>
                <div className="em-prev-sub">{r ? r.subject : "…"}</div>
                <div className="em-muted">To: {r ? `${r.to.name ? `${r.to.name} ` : ""}<${r.to.email}>` : "…"}</div>
              </div>
              <button type="button" className="em-x" onClick={() => setOpen(false)} aria-label="Close preview"><CloseIcon /></button>
            </div>
            {people.length > 1 && (
              <label className="em-prev-who">Preview for
                <select className="input" value={who} onChange={(e) => { setWho(e.target.value); run(e.target.value); }}>
                  {people.slice(0, 500).map((p) => <option key={p.user} value={p.user}>{p.name || p.email}{p.place ? ` · ${p.place}` : ""}</option>)}
                </select>
              </label>
            )}
            {r && r.missing.length > 0 && <div className="alert em-unknown">Empty for this person: {r.missing.map((m) => `{{${m}}}`).join(", ")}</div>}
            {r && r.needsForm && r.needsForm.length > 0 && <div className="alert info em-unknown">{r.needsForm.map((m) => `{{${m}}}`).join(", ")}: filled in once the form is chosen (when sending).</div>}
            {busy && !r ? <div className="em-loading">Preparing…</div> : r && <iframe className="em-prev-frame" title="Email preview" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:16px">${r.html}</body>`} />}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Templates tab
export function Templates({ meta, reload, fail, setMsg, onUse, onAuthExpired, maxMb }) {
  const [editing, setEditing] = useState(null); // null | "new" | id
  if (editing) return <TemplateEditor id={editing === "new" ? null : editing} meta={meta} fail={fail} maxMb={maxMb} onAuthExpired={onAuthExpired}
    onDone={(text) => { setEditing(null); reload(); if (text) setMsg({ type: "ok", text }); }} onUse={onUse} />;
  return (
    <section className="panel">
      <div className="panel-head">
        <div><h2>Templates</h2><p>Ready-made emails with {"{{variables}}"} filled in for each person. Use them in Write email (and for reminders later).</p></div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>+ New template</button>
      </div>
      <div className="table-wrap">
        {meta.templates.length === 0 ? <p className="em-muted em-empty">No templates yet. Click "New template" to make the first one.</p> : (
          <table className="master-table card-rows em-table">
            <thead><tr><th>Name</th><th>Subject</th><th>CC / BCC</th><th>Attachments</th><th>Last changed</th><th /></tr></thead>
            <tbody>
              {meta.templates.map((t) => (
                <tr key={t.id} className="em-click" onClick={() => setEditing(t.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setEditing(t.id); }}>
                  <td data-label="Name"><b>{t.name}</b></td>
                  <td data-label="Subject">{t.subject}</td>
                  <td data-label="CC / BCC">{t.cc.length || t.bcc.length ? `${t.cc.length} CC · ${t.bcc.length} BCC` : "—"}</td>
                  <td data-label="Attachments">{t.files.length ? plural(t.files.length, "file") : "—"}</td>
                  <td data-label="Last changed">{when(t.updatedAt)}<small className="em-muted"> {t.updatedBy}</small></td>
                  <td data-label=""><button type="button" className="btn btn-ghost em-use" onClick={(e) => { e.stopPropagation(); onUse(t.id); }}>Use</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function TemplateEditor({ id, meta, fail, onDone, onUse, maxMb, onAuthExpired }) {
  const [t, setT] = useState(id ? null : { name: "", subject: "", html: "", cc: [], bcc: [], greeting: true, files: [] });
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const html = useRef("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [greeting, setGreeting] = useState(true);
  const [keep, setKeep] = useState([]); // indexes of saved attachments kept
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const subj = useRef(null);

  const fill = useCallback((x) => {
    setT(x); setName(x.name); setSubject(x.subject); html.current = x.html; setCc(x.cc.join(", ")); setBcc(x.bcc.join(", "));
    setGreeting(x.greeting); setKeep(x.files.map((f, i) => i)); setFiles([]); setKey((k) => k + 1); setDirty(false);
  }, []);
  useEffect(() => { if (id) templateGet(id).then((r) => fill(r.template)).catch(fail); }, [id, fill, fail]);
  if (!t) return <div className="panel em-loading">Loading…</div>;

  const body = () => ({ name, subject, html: html.current, cc: toList(cc), bcc: toList(bcc), greeting, files: files.filter((f) => f.id).map((f) => f.id), keepFiles: keep });
  const save = async () => {
    if (files.some((f) => !f.id && !f.error)) return fail(new Error("Wait for the attachments to finish uploading."));
    setBusy(true);
    try {
      const r = id ? await templateSave(id, body()) : await templateCreate(body());
      fill(r.template);
      onDone(`Template "${r.template.name}" saved.`);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!(await confirmDialog({ title: "Delete this template?", message: `It gets status D (deleted) in the database and can't be restored. A new template can use the same name.`, confirmText: "Delete", tone: "danger" }))) return;
    try { await templateDelete(id); onDone(`Template "${t.name}" deleted.`); } catch (e) { fail(e); }
  };
  const back = async () => {
    if (dirty && !(await confirmDialog({ title: "Leave without saving?", message: "Your changes to this template will be lost.", confirmText: "Leave", tone: "caution" }))) return;
    onDone("");
  };
  const addVarToSubject = (k) => {
    const el = subj.current;
    const at = el ? el.selectionStart ?? subject.length : subject.length;
    setSubject(`${subject.slice(0, at)}{{${k}}}${subject.slice(at)}`); setDirty(true);
  };
  const build = () => ({ subject: subject || "(no subject)", html: html.current, greeting });

  return (
    <div className="em-one">
      <div className="em-one-head">
        <button type="button" className="btn btn-ghost em-back" onClick={back}>← All templates</button>
        <div className="em-one-actions">
          {id && <button type="button" className="btn btn-ghost" onClick={del}>Delete</button>}
          {id && <button type="button" className="btn btn-ghost" onClick={() => onUse(id)} disabled={dirty} title={dirty ? "Save first" : ""}>Use in an email</button>}
        </div>
      </div>
      <section className="panel em-card">
        <div className="panel-head"><div><h2>{id ? "Edit template" : "New template"}</h2><p>Variables such as {"{{Coordinator name}}"} or {"{{Form link}}"} are filled in for each person when the email is sent.</p></div></div>
        <div className="em-body">
          <label className="em-label" htmlFor="tp-name">Template name <small>(only you see this)</small></label>
          <input id="tp-name" className="input" maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} placeholder="e.g. Form reminder – 2 days left" />
          <div className="em-label-row">
            <label className="em-label" htmlFor="tp-subject">Subject</label>
            <select className="re-sel em-subj-var" value="" aria-label="Insert a variable in the subject" onChange={(e) => { if (e.target.value) addVarToSubject(e.target.value); }}>
              <option value="" hidden>{"{{ }}"} Insert variable</option>
              {meta.variables.map((v) => <option key={v.key} value={v.key}>{v.group}: {v.key}</option>)}
            </select>
          </div>
          <input id="tp-subject" ref={subj} className="input em-subject" maxLength={200} value={subject} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} placeholder="e.g. Reminder: {{Form title}} closes {{Form closes}}" />
          <div className="em-label">Body</div>
          <RichEditor resetKey={`${id || "new"}-${key}`} initialHtml={t.html} onChange={(h) => { html.current = h; setDirty(true); }} variables={meta.variables}
            uploadPublic={emailPublic} onError={(m) => fail(new Error(m))} />
          <label className="em-check"><input type="checkbox" checked={greeting} onChange={(e) => { setGreeting(e.target.checked); setDirty(true); }} /> Start with "Salaam (their name)," <small className="em-muted">(untick if the body has its own greeting)</small></label>
          <CopyFields cc={cc} setCc={(v) => { setCc(v); setDirty(true); }} bcc={bcc} setBcc={(v) => { setBcc(v); setDirty(true); }} />
          <div className="em-label">Attachments</div>
          <Attachments kept={t.files.filter((f, i) => keep.includes(i))} onDropKept={(i) => { const idx = t.files.map((f, j) => j).filter((j) => keep.includes(j))[i]; setKeep((k) => k.filter((x) => x !== idx)); setDirty(true); }}
            files={files} setFiles={(f) => { setFiles(f); setDirty(true); }} maxMb={maxMb} onAuthExpired={onAuthExpired} />
          <div className="em-actions">
            <PreviewButton build={build} fail={fail} label="Preview (as you)" />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save template"}</button>
          </div>
        </div>
      </section>
      <VariableHelp meta={meta} />
    </div>
  );
}

export function VariableHelp({ meta }) {
  const data = meta.variables.filter((v) => v.group === "Data (Excel)");
  const c = meta.contact || {};
  return (
    <details className="panel em-help">
      <summary>About variables</summary>
      <div className="em-body">
        <p>Write a variable in double curly brackets, or pick it from <b>{"{{ }}"} Variable</b> in the toolbar. When the email is sent, each person gets their own value: <code>{"{{Coordinator name}}"}</code> becomes the Jamaat Coordinator of <i>their</i> Jamaat.</p>
        <ul>
          <li><b>Times</b> ({"{{Form closes}}"}, {"{{Send time}}"} …) are written in the person's own time zone (their Jamaat's country; India for now).</li>
          <li><b>{"{{Form …}}"}</b> variables need a form: you choose it when sending. {"{{Form link}}"} is each person's own link.</li>
          <li><b>Data (Excel)</b>: every column of the uploaded Data Excel is a variable for that Jamaat{data.length ? `: ${data.map((v) => v.key).join(", ")}` : " (no Data Excel uploaded yet)"}. A new upload with new columns (Aamil Saheb, Tibb lead, …) adds them here automatically.</li>
          <li><b>Contact</b> details come from the server settings (Render): name "{c.name || "—"}", email "{c.email || "not set"}", phone "{c.phone || "not set"}".</li>
          <li>A value that is empty for someone (e.g. a Jamaat with no Coordinator) is left blank. "Preview" shows which ones are empty.</li>
        </ul>
      </div>
    </details>
  );
}
