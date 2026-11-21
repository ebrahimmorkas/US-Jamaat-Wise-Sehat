import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Notice from "./components/Notice";
import FormView, { fmtWhen, myZone } from "./components/FormView";
import { confirmDialog } from "./components/ConfirmDialog";
import { CloseIcon, DownloadIcon, EyeIcon, UploadIcon } from "./components/Icons";
import {
  AuthError, isServerStarting, formsList, formGet, formCreate, formSave, formStatus, formTopImage, formTopImageRemove,
  formLinkFor, formClearTests, formDelete, formRestore, formLinksExcel,
} from "./lib/api";
import { deletedLine, plural } from "./lib/helpers";

// Super Admin: forms (instead of Google Forms) for Jamaat Coordinators.
const STATUS = {
  draft: { label: "Draft", tone: "na" },
  testing: { label: "Testing", tone: "warn" },
  published: { label: "Published", tone: "good" },
  closed: { label: "Closed", tone: "bad" },
};
const STATE_TEXT = { open: "Open now", not_started: "Not open yet", ended: "Ended", closed: "Closed", draft: "Draft", testing: "Testers only" };
const ACCESS = {
  personal_link: { label: "Personal link (no sign-in)", hint: "Each Coordinator gets their own link with their Gmail inside it. Nobody can change the Gmail. Recommended." },
  signed_in: { label: "Sign in with Google", hint: "Only Jamaat Coordinators who sign in with their Gmail can fill it." },
  anyone: { label: "Anyone with the link", hint: "No sign-in. They type their email: only emails of Jamaat Coordinators are accepted (it can't be proven it is them). They choose their Jamiat and Jamaat." },
};
const UNITS = { KB: 1 / 1024, MB: 1, GB: 1024 };

let uidN = 0;
const uid = () => `u${++uidN}`;
const pad = (n) => String(n).padStart(2, "0");
const toLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (s) => (s ? new Date(s).toISOString() : null);
const sizeIn = (mb) => {
  if (mb == null || mb === "") return { n: "", unit: "MB" };
  if (mb >= 1024 && mb % 1024 === 0) return { n: String(mb / 1024), unit: "GB" };
  if (mb < 1) return { n: String(Math.round(mb * 1024)), unit: "KB" };
  return { n: String(mb), unit: "MB" };
};
const sizeOut = (s) => (s && s.n !== "" && s.n != null ? Math.round(Number(s.n) * UNITS[s.unit] * 1000) / 1000 : null);
const numOut = (v) => (v === "" || v == null ? null : Number(v));
const copy = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
};

const blankField = (type) => ({
  uid: uid(), type, label: "", help: "", placeholder: "", required: false, optionsText: ["select", "multi_select", "radio", "checkbox"].includes(type) ? "Option 1\nOption 2" : "",
  options: [], min: "", max: type === "rating" ? "5" : "", accept: [], size: { n: "", unit: "MB" }, maxFiles: "1",
});
function toDraft(f) {
  return {
    id: f.id, title: f.title, description: f.description, startAt: toLocal(f.startAt), endAt: toLocal(f.endAt), access: f.access,
    maxPerPerson: f.maxPerPerson == null ? "" : String(f.maxPerPerson), allowEdit: f.allowEdit, sendCopy: f.sendCopy,
    reminderHours: f.reminderHours || [], imageExt: f.imageExt || [], imageSize: sizeIn(f.imageMaxMb),
    fields: f.fields.filter((x) => !x.hidden).map((x) => ({
      uid: uid(), key: x.key, type: x.type, label: x.label || "", help: x.help || "", placeholder: x.placeholder || "", required: !!x.required,
      options: x.options || [], optionsText: (x.options || []).map((o) => o.label).join("\n"),
      min: x.min == null ? "" : String(x.min), max: x.max == null ? "" : String(x.max), accept: x.accept || [], size: sizeIn(x.maxSizeMb),
      maxFiles: x.maxFiles == null ? "1" : String(x.maxFiles),
    })),
  };
}
const newDraft = () => ({ id: "", title: "", description: "", startAt: "", endAt: "", access: "personal_link", maxPerPerson: "", allowEdit: false, sendCopy: false, reminderHours: [], imageExt: [], imageSize: { n: "", unit: "MB" }, fields: [blankField("short_text")] });
// Choices keep their ids when the text is the same, so saved answers stay linked.
function toBody(d) {
  return {
    title: d.title, description: d.description, startAt: fromLocal(d.startAt), endAt: fromLocal(d.endAt), access: d.access,
    maxPerPerson: d.maxPerPerson === "" ? null : Number(d.maxPerPerson), allowEdit: d.allowEdit, sendCopy: d.sendCopy,
    reminderHours: d.reminderHours, imageExt: d.imageExt, imageMaxMb: sizeOut(d.imageSize),
    fields: d.fields.map((f) => ({
      key: f.key, type: f.type, label: f.label, help: f.help, placeholder: f.placeholder, required: f.required,
      options: f.optionsText.split("\n").map((s) => s.trim()).filter(Boolean).map((label) => ({ label, id: (f.options.find((o) => o.label === label) || {}).id })),
      min: numOut(f.min), max: numOut(f.max), accept: f.accept, maxSizeMb: sizeOut(f.size), maxFiles: numOut(f.maxFiles),
    })),
  };
}
// The form as the filler sees it (for the preview).
function previewForm(d, meta, topImage) {
  return {
    title: d.title, description: d.description, topImage,
    fields: d.fields.map((f, i) => {
      const kind = (meta.types.find((t) => t.key === f.type) || {}).upload;
      const ext = kind ? (f.accept.length ? f.accept : kind === "image" && d.imageExt.length ? d.imageExt : meta.extensions[kind]) : undefined;
      return {
        key: f.key || f.uid || String(i), type: f.type, label: f.label, help: f.help, placeholder: f.placeholder, required: f.required,
        options: f.optionsText.split("\n").map((s) => s.trim()).filter(Boolean), min: numOut(f.min), max: numOut(f.max), maxFiles: numOut(f.maxFiles) || 1,
        accept: ext, maxMb: kind ? Math.min(sizeOut(f.size) || (kind === "image" && sizeOut(d.imageSize)) || meta.maxMb[kind], meta.maxMb[kind]) : undefined,
      };
    }),
  };
}

export default function FormsAdmin({ onAuthExpired }) {
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [open, setOpen] = useState(null); // the form being edited (server copy) or "new"
  const [showDeleted, setShowDeleted] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((err) => {
    if (err instanceof AuthError) return onAuthExpired();
    setMsg({ type: "error", text: err.message });
  }, [onAuthExpired]);

  const load = useCallback(async (tries = 0) => {
    try {
      const r = await formsList();
      setList(r.forms); setMeta(r.meta);
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) { setLoadMsg("Connecting to the server…"); setTimeout(() => load(tries + 1), 5000); }
      else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, okText) => {
    setBusy(true); setMsg(null);
    try { await fn(); await load(); if (okText) setMsg({ type: "ok", text: okText }); return true; } catch (err) { fail(err); return false; } finally { setBusy(false); }
  };

  if (!list || !meta) return <div className="panel portal-empty" style={{ marginTop: 28 }}>{loadMsg}</div>;
  if (open) {
    return <FormEditor key={open === "new" ? "new" : open.id} start={open === "new" ? null : open} meta={meta} onAuthExpired={onAuthExpired}
      onClose={() => { setOpen(null); load(); }} />;
  }

  const shown = list.filter((f) => showDeleted || !f.deleted);
  const deletedCount = list.filter((f) => f.deleted).length;
  const edit = async (f) => { try { const r = await formGet(f.id); setOpen(r.form); } catch (err) { fail(err); } };
  const remove = async (f) => {
    if (!(await confirmDialog({ tone: "danger", title: `Delete “${f.title}”?`, confirmText: "Delete",
      message: `It gets status D (deleted): its link stops working at once.\n\nNothing is erased (${plural(f.responses, "response")} kept); you can restore it from “Show deleted”.` }))) return;
    act(() => formDelete(f.id), `Deleted “${f.title}”. Tick “Show deleted” to restore.`);
  };

  return (
    <>
      <section className="page-head">
        <div className="page-title">
          <h1>Forms</h1>
          <p className="page-sub">Build forms for Jamaat Coordinators instead of Google Forms. A form goes Draft → Testing (only testers can fill) → Published → Closed.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setOpen("new")}>New form</button>
      </section>
      {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}
      <div className="panel">
        <div className="add-line users-tools">
          <label className="check show-deleted"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted ({deletedCount})</label>
        </div>
        <div className="table-wrap">
          <table className="master-table card-rows forms-table">
            <thead><tr><th>#</th><th>Form</th><th>Status</th><th>Open</th><th>Who can fill</th><th>Responses</th><th /></tr></thead>
            <tbody>
              {shown.map((f, i) => (
                <tr key={f.id} className={f.deleted ? "is-deleted" : ""}>
                  <td className="idx">{i + 1}</td>
                  <td className="cell-main"><span className="jm-name">{f.title}</span><small className="user-sub">{plural(f.fields.filter((x) => !x.hidden && !["heading", "paragraph"].includes(x.type)).length, "question")}</small></td>
                  <td data-label="Status">{f.deleted ? <span className="pill bad" title={deletedLine(f)}>Deleted (D)</span> : <span className={`pill ${STATUS[f.status].tone}`}>{STATUS[f.status].label}</span>}
                    {!f.deleted && f.status !== "draft" && STATE_TEXT[f.state] !== STATUS[f.status].label && <small className="user-sub">{STATE_TEXT[f.state]}</small>}</td>
                  <td className="muted" data-label="Open">{f.startAt ? <>{fmtWhen(f.startAt)}<br />to {fmtWhen(f.endAt)}</> : "Dates not set"}</td>
                  <td data-label="Who can fill">{ACCESS[f.access].label}</td>
                  <td data-label="Responses">{f.responses}{f.testResponses ? <small className="user-sub">+ {f.testResponses} test</small> : null}</td>
                  <td className="row-actions">
                    {f.deleted ? <button type="button" className="mini-btn primary" disabled={busy} onClick={() => act(() => formRestore(f.id), `Restored “${f.title}”.`)}>Restore</button> : <>
                      <button type="button" className="mini-btn" onClick={() => edit(f)} disabled={busy}>Edit</button>
                      {f.status !== "draft" && <button type="button" className="mini-btn" onClick={() => copy(f.link).then(() => setMsg({ type: "ok", text: f.access === "personal_link" ? "Copied the form's address. People need their own personal link to fill it (Edit → Share this form)." : "Link copied." }))}>Copy link</button>}
                      <button type="button" className="mini-btn danger" onClick={() => remove(f)} disabled={busy}>Delete</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && <div className="empty-state">No forms yet. Click “New form” to build the first one.</div>}
        </div>
      </div>
    </>
  );
}

// ---------- The editor ----------
function FormEditor({ start, meta, onClose, onAuthExpired }) {
  const [saved, setSaved] = useState(start); // server copy (null = not created yet)
  const [d, setD] = useState(() => (start ? toDraft(start) : newDraft()));
  const [base, setBase] = useState(() => JSON.stringify(toBody(start ? toDraft(start) : newDraft())));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [hourText, setHourText] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [personal, setPersonal] = useState("");
  const [pendingTop, setPendingTop] = useState(null); // { file, url }: chosen before the form exists, uploaded on Create
  const top = useRef(null);
  const dirty = JSON.stringify(toBody(d)) !== base;
  const answered = useMemo(() => new Set((saved && saved.answered) || []), [saved]);
  const zone = myZone();

  const fail = (err) => { if (err instanceof AuthError) return onAuthExpired(); setMsg({ type: "error", text: err.message }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const took = (f) => { setSaved(f); const nd = toDraft(f); setD(nd); setBase(JSON.stringify(toBody(nd))); };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = saved ? await formSave(saved.id, toBody(d)) : await formCreate(toBody(d));
      let form = r.form;
      let note = "";
      if (!saved && pendingTop) {
        try {
          const t = await formTopImage(form.id, pendingTop.file);
          form = { ...form, topImage: t.topImage };
          URL.revokeObjectURL(pendingTop.url);
          setPendingTop(null);
        } catch (err) { note = ` But the top image couldn't be uploaded (${err.message}); add it again under “Top image”.`; }
      }
      took(form);
      setMsg({ type: note ? "error" : "ok", text: saved ? "Saved." : `Form created as a Draft. Next: “Move to Testing” to try it, then “Publish”.${note}` });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return form;
    } catch (err) { fail(err); return null; } finally { setBusy(false); }
  };
  const move = async (status, confirm) => {
    if (confirm && !(await confirmDialog(confirm))) return;
    let f = saved;
    if (dirty) { f = await save(); if (!f) return; }
    setBusy(true); setMsg(null);
    try { const r = await formStatus(f.id, status); took({ ...r.form, answered: f.answered }); setMsg({ type: "ok", text: `The form is now ${STATUS[status].label}.` }); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };
  const close = async () => {
    if (dirty && !(await confirmDialog({ tone: "warn", title: "Leave without saving?", confirmText: "Leave", message: "Your changes to this form will be lost." }))) return;
    onClose();
  };

  const setF = (i, patch) => setD((s) => ({ ...s, fields: s.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const moveF = (i, by) => setD((s) => {
    const fields = [...s.fields]; const j = i + by;
    if (j < 0 || j >= fields.length) return s;
    [fields[i], fields[j]] = [fields[j], fields[i]];
    return { ...s, fields };
  });
  const removeF = async (i) => {
    const f = d.fields[i];
    if (f.key && answered.has(f.key) && !(await confirmDialog({ tone: "warn", title: "Remove this question?", confirmText: "Remove",
      message: "People have already answered it. It is hidden from the form, and the answers already sent are kept." }))) return;
    setD((s) => ({ ...s, fields: s.fields.filter((_, j) => j !== i) }));
  };
  const addF = (type) => { if (!type) return; setD((s) => ({ ...s, fields: [...s.fields, blankField(type)] })); };
  const dupF = (i) => setD((s) => { const f = s.fields[i]; const c = { ...f, uid: uid(), key: undefined, options: [], label: f.label ? `${f.label} (copy)` : "" }; const fields = [...s.fields]; fields.splice(i + 1, 0, c); return { ...s, fields }; });

  const addHour = () => {
    const h = Number(hourText);
    if (!Number.isInteger(h) || h < 1) return setMsg({ type: "error", text: "Reminder: type a whole number of hours (1 or more)." });
    if (d.startAt && d.endAt && h >= (new Date(d.endAt) - new Date(d.startAt)) / 3600000) return setMsg({ type: "error", text: `A reminder after ${h} hours would be after the form closes.` });
    setD((s) => ({ ...s, reminderHours: [...new Set([...s.reminderHours, h])].sort((a, b) => a - b) }));
    setHourText("");
  };

  const upTop = async (file) => {
    if (!saved) return;
    setBusy(true); setMsg(null);
    try { const r = await formTopImage(saved.id, file); setSaved((s) => ({ ...s, topImage: r.topImage })); setMsg({ type: "ok", text: "Top image saved." }); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };
  const dropTop = async () => {
    setBusy(true);
    try { await formTopImageRemove(saved.id); setSaved((s) => ({ ...s, topImage: null })); } catch (err) { fail(err); } finally { setBusy(false); }
  };
  const getPersonal = async () => {
    try { const r = await formLinkFor(saved.id, linkEmail.trim()); setPersonal(r.link); } catch (err) { fail(err); }
  };
  const clearTests = async () => {
    if (!(await confirmDialog({ tone: "danger", title: `Remove ${plural(saved.testResponses, "test response")}?`, confirmText: "Remove",
      message: "Everything filled while testing (and its files) is removed for good. Real responses are not touched." }))) return;
    setBusy(true);
    try { const r = await formClearTests(saved.id); setSaved((s) => ({ ...s, testResponses: 0 })); setMsg({ type: "ok", text: `Removed ${plural(r.removed, "test response")}.` }); }
    catch (err) { fail(err); } finally { setBusy(false); }
  };

  const status = saved ? saved.status : "draft";
  const types = meta.types;
  const groups = [...new Set(types.map((t) => t.group))];
  const extChips = (kind, selected, onChange) => (
    <div className="chips">
      {meta.extensions[kind].map((e) => (
        <label key={e} className={`chip-check${selected.includes(e) ? " is-on" : ""}`}>
          <input type="checkbox" checked={selected.includes(e)} onChange={(ev) => onChange(ev.target.checked ? [...selected, e] : selected.filter((x) => x !== e))} />{e.toUpperCase()}
        </label>
      ))}
    </div>
  );
  const sizeBox = (val, onChange, cap) => (
    <span className="size-box">
      <input className="input" type="number" min="0" step="any" value={val.n} placeholder={`max ${cap} MB`} onChange={(e) => onChange({ ...val, n: e.target.value })} />
      <select value={val.unit} onChange={(e) => onChange({ ...val, unit: e.target.value })}>{Object.keys(UNITS).map((u) => <option key={u}>{u}</option>)}</select>
    </span>
  );

  return (
    <div className="form-editor" ref={top}>
      <section className="page-head">
        <div className="page-title">
          <button type="button" className="btn btn-ghost back-btn" onClick={close}>← Back to all forms</button>
          <h1>{d.title || "New form"} {saved && <span className={`pill ${STATUS[status].tone}`}>{STATUS[status].label}</span>}</h1>
          <p className="page-sub">{saved ? `${plural(saved.responses, "response")}${saved.testResponses ? ` · ${plural(saved.testResponses, "test response")}` : ""} · ${STATE_TEXT[saved.state] || ""}` : "Not saved yet."}</p>
        </div>
        <div className="editor-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setPreview(true)}><EyeIcon /> <span>Preview</span></button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || (saved && !dirty)}>{busy ? "Saving…" : saved ? (dirty ? "Save changes" : "Saved") : "Create form"}</button>
        </div>
      </section>
      {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}

      {saved && (
        <div className="panel status-bar">
          <div className="status-steps">
            {["draft", "testing", "published", "closed"].map((s) => <span key={s} className={`step${s === status ? " is-on" : ""}`}>{STATUS[s].label}</span>)}
          </div>
          <div className="status-btns">
            {status === "draft" && <>
              <button type="button" className="btn btn-warn" disabled={busy} onClick={() => move("testing")}>Move to Testing</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => move("published", { tone: "warn", title: "Publish without testing?", confirmText: "Publish", message: "Everyone with a link can fill it from the start time. You can test it first with “Move to Testing”." })}>Publish</button>
            </>}
            {status === "testing" && <>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => move("draft")}>Back to Draft</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => move("published", { tone: "info", title: "Publish this form?", confirmText: "Publish", message: `Jamaat Coordinators can fill it from ${fmtWhen(fromLocal(d.startAt))} (your time).${saved.testResponses ? `\n\nThere ${saved.testResponses === 1 ? "is 1 test response" : `are ${saved.testResponses} test responses`}; you can remove ${saved.testResponses === 1 ? "it" : "them"} with “Remove test responses”.` : ""}` })}>Publish</button>
            </>}
            {status === "published" && <>
              {!saved.responses && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => move("testing")}>Back to Testing</button>}
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => move("closed", { tone: "danger", title: "Close this form now?", confirmText: "Close form", message: "Nobody can fill it any more (you can reopen it)." })}>Close now</button>
            </>}
            {status === "closed" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => move("published")}>Reopen</button>}
            {saved.testResponses > 0 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={clearTests}>Remove test responses ({saved.testResponses})</button>}
          </div>
          {status === "draft" && <p className="status-note">The links to share appear here once you move the form to Testing or Published.</p>}
          {status === "testing" && <p className="status-note">Only users ticked as <b>Tester</b> (Users page) can fill it now, after signing in. Their responses are marked “Test”.</p>}
        </div>
      )}

      {saved && status !== "draft" && (
        <div className="panel ed-section share-panel">
          <h2>Share this form</h2>
          {status === "testing" && <p className="field-hint"><b>Testing:</b> open the link below in this browser (you are signed in). Only users ticked as Tester can fill it; everyone else is refused until you publish.</p>}
          <span className="field-label">The form's link{d.access === "personal_link" ? " (for testers; Coordinators get personal links below)" : ""}</span>
          <div className="link-out"><code>{saved.link}</code>
            <button type="button" className="mini-btn primary" onClick={() => copy(saved.link).then(() => setMsg({ type: "ok", text: "Link copied." }))}>Copy</button>
            <a className="mini-btn" href={saved.link} target="_blank" rel="noreferrer">Open</a></div>
          {d.access === "personal_link" && <>
            <p className="field-hint">Each Coordinator needs their own personal link (their Gmail is inside it, so send each one only to that person). JCs also see their Coordinators' links on their dashboard once the form is published.</p>
            <div className="share-grid">
              <label className="field wide"><span className="field-label">Personal link for one email</span>
                <span className="add-line"><input className="input" type="email" value={linkEmail} placeholder="name@gmail.com" onChange={(e) => { setLinkEmail(e.target.value); setPersonal(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && linkEmail.trim()) { e.preventDefault(); getPersonal(); } }} />
                  <button type="button" className="btn btn-ghost" onClick={getPersonal} disabled={!linkEmail.trim()}>Get link</button></span></label>
              <div className="field"><span className="field-label">Everyone at once</span>
                <button type="button" className="btn btn-ghost" onClick={() => formLinksExcel(saved.id).catch(fail)}><DownloadIcon /> <span>Excel: links of all Coordinators</span></button></div>
            </div>
            {personal && <div className="link-out"><code>{personal}</code><button type="button" className="mini-btn primary" onClick={() => copy(personal).then(() => setMsg({ type: "ok", text: "Personal link copied." }))}>Copy</button></div>}
          </>}
          {d.access !== "personal_link" && <button type="button" className="btn btn-ghost" onClick={() => formLinksExcel(saved.id).catch(fail)}><DownloadIcon /> <span>Excel: all Coordinators</span></button>}
        </div>
      )}

      <div className="editor-grid">
        <div className="editor-main">
          <div className="panel ed-section">
            <h2>Title and description</h2>
            <label className="field wide"><span className="field-label">Title *</span>
              <input className="input" value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Monthly Jamaat report – Jumada al-Ula" /></label>
            <label className="field wide"><span className="field-label">Description</span>
              <textarea className="input" rows={3} maxLength={5000} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="What this form is for (shown under the title)" /></label>
            <div className="field wide">
              <span className="field-label">Top image</span>
              {!saved ? (pendingTop ? (
                <div className="top-img"><img src={pendingTop.url} alt="Top image" />
                  <button type="button" className="mini-btn danger" onClick={() => { URL.revokeObjectURL(pendingTop.url); setPendingTop(null); }}>Remove</button>
                  <span className="field-hint">It is uploaded when you click “Create form”.</span></div>
              ) : (
                <label className="btn btn-ghost file-btn"><UploadIcon /> <span>Upload image</span>
                  <input type="file" hidden accept=".jpg,.jpeg,.png,.webp,.gif" onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setPendingTop({ file: f, url: URL.createObjectURL(f) }); }} /></label>
              )) : saved.topImage ? (
                <div className="top-img"><img src={saved.topImage.src} alt="Top image" /><button type="button" className="mini-btn danger" onClick={dropTop} disabled={busy}>Remove</button></div>
              ) : (
                <label className="btn btn-ghost file-btn"><UploadIcon /> <span>Upload image</span>
                  <input type="file" hidden accept=".jpg,.jpeg,.png,.webp,.gif" onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) upTop(f); }} /></label>
              )}
            </div>
          </div>

          <div className="panel ed-section">
            <h2>Questions</h2>
            {d.fields.map((f, i) => (
              <FieldCard key={f.uid} f={f} i={i} count={d.fields.length} types={types} groups={groups} meta={meta} locked={!!f.key && answered.has(f.key)}
                set={(p) => setF(i, p)} up={() => moveF(i, -1)} down={() => moveF(i, 1)} remove={() => removeF(i)} dup={() => dupF(i)}
                extChips={extChips} sizeBox={sizeBox} />
            ))}
            <label className="field add-q"><span className="field-label">Add a field</span>
              <select value="" onChange={(e) => addF(e.target.value)}>
                <option value="">Choose a field type…</option>
                {groups.map((g) => <optgroup key={g} label={g}>{types.filter((t) => t.group === g).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</optgroup>)}
              </select></label>
          </div>
        </div>

        <div className="editor-side">
          <div className="panel ed-section">
            <h2>When</h2>
            <p className="field-hint">In your time{zone ? ` (${zone})` : ""}. People in other countries see it in their own time.</p>
            <label className="field wide"><span className="field-label">Start date and time *</span>
              <input className="input" type="datetime-local" value={d.startAt} onChange={(e) => setD({ ...d, startAt: e.target.value })} /></label>
            <label className="field wide"><span className="field-label">End date and time *</span>
              <input className="input" type="datetime-local" value={d.endAt} min={d.startAt || undefined} onChange={(e) => setD({ ...d, endAt: e.target.value })} /></label>
          </div>

          <div className="panel ed-section">
            <h2>Who can fill</h2>
            <div className="access-cards">
              {Object.entries(ACCESS).map(([k, a]) => (
                <label key={k} className={`access-card${d.access === k ? " is-on" : ""}`}>
                  <input type="radio" name="access" checked={d.access === k} onChange={() => setD({ ...d, access: k })} />
                  <span><b>{a.label}</b><small>{a.hint}</small></span>
                </label>
              ))}
            </div>
            <label className="field wide"><span className="field-label">Times one person can fill it</span>
              <input className="input" type="number" min="1" step="1" value={d.maxPerPerson} placeholder="No limit"
                onChange={(e) => setD({ ...d, maxPerPerson: e.target.value === "0" ? "" : e.target.value.replace(/[^\d]/g, "") })} />
              <span className="field-hint">Empty = no limit. 0 is not allowed.</span></label>
            <label className="check"><input type="checkbox" checked={d.allowEdit} onChange={(e) => setD({ ...d, allowEdit: e.target.checked })} /> They can change their response until the end time</label>
            <label className="check"><input type="checkbox" checked={d.sendCopy} onChange={(e) => setD({ ...d, sendCopy: e.target.checked })} /> Send them a copy of their response by email</label>
            {d.sendCopy && <p className="field-hint">Emails start working with the email part (coming next).</p>}
          </div>

          <div className="panel ed-section">
            <h2>Reminders</h2>
            <p className="field-hint">Hours after the start time. Sent only to people who haven't filled it, never after the end.</p>
            <div className="hours">
              {d.reminderHours.map((h) => (
                <span key={h} className="hour-chip">after {h} h
                  <button type="button" aria-label={`Remove ${h} hours`} onClick={() => setD({ ...d, reminderHours: d.reminderHours.filter((x) => x !== h) })}><CloseIcon /></button></span>
              ))}
            </div>
            <div className="add-line">
              <input className="input" type="number" min="1" step="1" value={hourText} placeholder="e.g. 12" onChange={(e) => setHourText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHour(); } }} />
              <button type="button" className="btn btn-ghost" onClick={addHour}>Add</button>
            </div>
            <label className="field wide"><span className="field-label">Reminder template</span>
              <select disabled><option>Templates come with the email part</option></select></label>
          </div>

          <div className="panel ed-section">
            <h2>Image uploads</h2>
            <p className="field-hint">Defaults for every image question (each question can set its own).</p>
            <span className="field-label">Allowed image types</span>
            {extChips("image", d.imageExt, (v) => setD({ ...d, imageExt: v }))}
            <span className="field-hint">None ticked = all of them.</span>
            <label className="field wide"><span className="field-label">Size limit per image</span>{sizeBox(d.imageSize, (v) => setD({ ...d, imageSize: v }), meta.maxMb.image)}
              <span className="field-hint">Highest allowed: {meta.maxMb.image} MB (set on the server).</span></label>
          </div>

        </div>
      </div>

      <div className="panel editor-foot">
        <button type="button" className="btn btn-ghost" onClick={close}>← Back to all forms</button>
        <span className="editor-foot-right">
          {dirty && saved && <span className="muted">Unsaved changes</span>}
          <button type="button" className="btn btn-ghost" onClick={() => setPreview(true)}><EyeIcon /> <span>Preview</span></button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || (saved && !dirty)}>{busy ? "Saving…" : saved ? (dirty ? "Save changes" : "Saved") : "Create form"}</button>
        </span>
      </div>

      {preview && <PreviewDialog form={previewForm(d, meta, saved && saved.topImage ? saved.topImage.src : pendingTop ? pendingTop.url : "")} onClose={() => setPreview(false)} />}
    </div>
  );
}

function FieldCard({ f, i, count, types, groups, meta, locked, set, up, down, remove, dup, extChips, sizeBox }) {
  const t = types.find((x) => x.key === f.type) || {};
  const layout = t.layout;
  return (
    <div className={`q-card${layout ? " is-layout" : ""}`}>
      <div className="q-card-top">
        <span className="q-n">{i + 1}</span>
        <select value={f.type} disabled={locked} title={locked ? "Already answered: the type can't change" : ""} onChange={(e) => set({ type: e.target.value, ...(["select", "multi_select", "radio", "checkbox"].includes(e.target.value) && !f.optionsText ? { optionsText: "Option 1\nOption 2" } : {}) })}>
          {groups.map((g) => <optgroup key={g} label={g}>{types.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
        </select>
        {locked && <span className="pill info" title="Its type can't change; removing it hides it and keeps the answers">Has answers</span>}
        <span className="q-tools">
          <button type="button" className="mini-btn icon" onClick={up} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
          <button type="button" className="mini-btn icon" onClick={down} disabled={i === count - 1} aria-label="Move down" title="Move down">↓</button>
          <button type="button" className="mini-btn" onClick={dup}>Copy</button>
          <button type="button" className="mini-btn danger" onClick={remove}>Remove</button>
        </span>
      </div>
      <label className="field wide"><span className="field-label">{f.type === "heading" ? "Heading" : f.type === "paragraph" ? "Title (optional)" : "Question"}</span>
        <input className="input" value={f.label} maxLength={300} onChange={(e) => set({ label: e.target.value })} /></label>
      <label className="field wide"><span className="field-label">{f.type === "paragraph" ? "Text" : "Description (optional)"}</span>
        <textarea className="input" rows={f.type === "paragraph" ? 3 : 1} maxLength={2000} value={f.help} onChange={(e) => set({ help: e.target.value })} /></label>

      {t.choice && (
        <label className="field wide"><span className="field-label">Choices (one per line)</span>
          <textarea className="input" rows={Math.min(8, Math.max(3, f.optionsText.split("\n").length + 1))} value={f.optionsText} onChange={(e) => set({ optionsText: e.target.value })} /></label>
      )}
      <div className="q-row">
        {["short_text", "long_text", "email", "phone", "number"].includes(f.type) && (
          <label className="field"><span className="field-label">Placeholder</span><input className="input" value={f.placeholder} maxLength={150} onChange={(e) => set({ placeholder: e.target.value })} /></label>
        )}
        {(f.type === "number" || f.type === "short_text" || f.type === "long_text" || t.many) && <>
          <label className="field small"><span className="field-label">{f.type === "number" ? "Smallest number allowed" : t.many ? "Fewest choices" : "Minimum characters"}</span>
            <input className="input" type="number" value={f.min} placeholder={f.type === "number" ? "e.g. 0" : "No minimum"} onChange={(e) => set({ min: e.target.value })} /></label>
          <label className="field small"><span className="field-label">{f.type === "number" ? "Largest number allowed" : t.many ? "Most choices" : "Maximum characters"}</span>
            <input className="input" type="number" value={f.max} placeholder={f.type === "number" ? "e.g. 500" : "No maximum"} onChange={(e) => set({ max: e.target.value })} /></label>
          <span className="field-hint q-minmax-hint">{f.type === "number"
            ? "The value of the answer, not how many digits it has. E.g. 1 and 100: people can enter 1, 57 or 100, but not 0 or 101. Leave empty for no limit."
            : t.many ? "How many options people must / may tick." : "How many letters (characters) the answer must / may have. People see it under the question."}</span>
        </>}
        {f.type === "rating" && (
          <label className="field small"><span className="field-label">Stars</span>
            <select value={f.max || "5"} onChange={(e) => set({ max: e.target.value })}>{[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        )}
        {t.upload && <>
          <label className="field small"><span className="field-label">Files allowed</span>
            <select value={f.maxFiles || "1"} onChange={(e) => set({ maxFiles: e.target.value })}>{Array.from({ length: 10 }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="field"><span className="field-label">Size limit per file</span>{sizeBox(f.size, (v) => set({ size: v }), meta.maxMb[t.upload])}</label>
        </>}
      </div>
      {t.upload && <>
        <span className="field-label">Allowed types {t.upload === "image" ? "(none ticked = the form's image defaults)" : "(none ticked = all)"}</span>
        {extChips(t.upload, f.accept, (v) => set({ accept: v }))}
      </>}
      {!layout && <label className="check"><input type="checkbox" checked={f.required} onChange={(e) => set({ required: e.target.checked })} /> Required</label>}
    </div>
  );
}

function PreviewDialog({ form, onClose }) {
  const [values, setValues] = useState({});
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="Form preview">
      <div className="preview-bar"><b>Preview</b><span className="muted">Nothing is sent from here.</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close preview"><CloseIcon /></button></div>
      <div className="preview-body"><div className="panel fv-card">
        <FormView form={form} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} preview onUpload={() => {}} onRemoveFile={() => {}} />
      </div></div>
    </div>
  );
}
