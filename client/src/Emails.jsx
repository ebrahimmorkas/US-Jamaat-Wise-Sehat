import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppBar from "./components/AppBar";
import MultiSelect from "./components/MultiSelect";
import Notice from "./components/Notice";
import RichEditor from "./components/RichEditor";
import { confirmDialog } from "./components/ConfirmDialog";
import { AuthError, isServerStarting, emailPeople, emailPreview, emailSend, emailList, emailGet, emailPublic, templateGet,
  emailCancel, emailRetry, emailProviders, emailSetProvider, emailTest } from "./lib/api";
import { lower, plural } from "./lib/helpers";
import { CloseIcon, SendIcon } from "./components/Icons";
import { useEmailMeta, Attachments, CopyFields, PreviewButton, Templates, VariableHelp, toList, size } from "./EmailTemplates";

// "Send email" — Super Admin (inside its portal: `embedded`) and Saheb (own page with its nav).
//   Write:     who gets it (groups, Jamiat / Jamaat, people, typed Gmails of portal users), from a template or new,
//              subject + rich body with {{variables}}, CC / BCC (one copy), attachments, form, now or later, preview.
//   Templates: reusable emails (subject, body, CC / BCC, attachments).
//   Sent:      every email with each person's result; cancel a scheduled one; send again to those it failed for.
//   Settings:  (Super Admin) which provider sends — Nodemailer (default and backup) or SendGrid; test email.

const ROLE_ONE = { jamaat_coordinator: "Jamaat Coordinator", jc: "JC", saheb: "Saheb", superadmin: "Super Admin" };
const STATUS = {
  scheduled: { label: "Scheduled", cls: "info" },
  sending: { label: "Sending", cls: "warn" },
  done: { label: "Sent", cls: "good" },
  failed: { label: "Failed", cls: "bad" },
  cancelled: { label: "Cancelled", cls: "na" },
};
const FORM_STAGE = { draft: "Draft", testing: "Testing", published: "Published", closed: "Closed" };
const when = (d) => (d ? new Date(d).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const splitEmails = (s) => [...new Set(String(s || "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
const localInput = (d) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
const usesForm = (...t) => t.some((s) => /\{\{\s*form (title|link|opens|closes)\s*\}\}|%7B%7Bform/i.test(String(s || "")));

export default function Emails({ embedded, nav, page, user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const isAdmin = user ? user.role === "superadmin" : !!embedded;
  const [tab, setTab] = useState("write");
  const [msg, setMsg] = useState(null);
  const [useTpl, setUseTpl] = useState(null); // a template to start "Write email" from
  const fail = useCallback((err) => { if (err instanceof AuthError) return onAuthExpired(); setMsg({ type: "error", text: err.message }); window.scrollTo({ top: 0, behavior: "smooth" }); }, [onAuthExpired]);
  const [meta, reloadTemplates] = useEmailMeta(fail);
  const [info, setInfo] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const load = useCallback(async (tries = 0) => {
    try { setInfo(await emailPeople()); }
    catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) { setLoadMsg("Connecting to the server…"); setTimeout(() => load(tries + 1), 5000); }
      else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);

  const go = (k) => { setTab(k); setMsg(null); };
  const body = (
    <div className="em-page">
      <section className="page-head"><div className="page-title"><h1>Send email</h1>
        <p className="page-sub">Email portal users: whole groups, the Jamaat Coordinators and JCs of chosen Jamiats or Jamaats, or chosen people. Start from a template or write it here, with formatting, images, variables and attachments, and send it now or at a set time.</p></div></section>
      <div className="cp-tabs" role="tablist">
        {[["write", "Write email"], ["templates", "Templates"], ["sent", "Sent & scheduled"], ...(isAdmin ? [["settings", "Settings"]] : [])].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => go(k)}>{l}</button>
        ))}
      </div>
      <Notice type={msg && msg.type} text={msg && msg.text} onClose={() => setMsg(null)} />
      {!info && tab !== "settings" && tab !== "sent" ? <div className="panel em-loading">{loadMsg}</div> : <>
        {tab === "write" && <Compose info={info} meta={meta} startTpl={useTpl} fail={fail} onAuthExpired={onAuthExpired}
          onSent={(text) => { setUseTpl(null); setMsg({ type: "ok", text }); setTab("sent"); }} />}
        {tab === "templates" && <Templates meta={meta} reload={reloadTemplates} fail={fail} setMsg={setMsg} maxMb={info.maxAttachMb} onAuthExpired={onAuthExpired}
          onUse={(id) => { setUseTpl({ id, at: Date.now() }); go("write"); }} />}
      </>}
      {tab === "sent" && <Sent fail={fail} setMsg={setMsg} />}
      {tab === "settings" && isAdmin && <Settings fail={fail} setMsg={setMsg} />}
    </div>
  );
  if (embedded) return body;
  return (
    <>
      <AppBar nav={nav} page={page} theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container">{body}</main>
    </>
  );
}

// ---------------------------------------------------------------- Write
function Compose({ info, meta, startTpl, fail, onSent, onAuthExpired }) {
  const [roles, setRoles] = useState([]);
  const [jamiats, setJamiats] = useState([]);
  const [jamaats, setJamaats] = useState([]); // "JAMIAT\u0000JAMAAT"
  const [picked, setPicked] = useState([]); // user ids
  const [typed, setTyped] = useState("");
  const [preview, setPreview] = useState(null);
  const [showList, setShowList] = useState(false);
  const [tpl, setTpl] = useState(null); // the template it started from ({ id, name, files })
  const [tplKeep, setTplKeep] = useState([]);
  const [subject, setSubject] = useState("");
  const html = useRef("");
  const [edKey, setEdKey] = useState(0);
  const [initial, setInitial] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [greeting, setGreeting] = useState(true);
  const [form, setForm] = useState("");
  const [files, setFiles] = useState([]);
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [bodyText, setBodyText] = useState(""); // to know if a {{Form …}} variable is used

  const to = useMemo(() => ({
    roles, jamiats,
    jamaats: jamaats.map((k) => { const [jamiat, jamaat] = k.split("\u0000"); return { jamiat, jamaat }; }),
    users: picked, emails: splitEmails(typed),
  }), [roles, jamiats, jamaats, picked, typed]);
  const anyone = roles.length || picked.length || to.emails.length;

  useEffect(() => {
    if (!anyone) { setPreview(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => emailPreview(to).then((r) => alive && setPreview(r)).catch((e) => alive && fail(e)), 350);
    return () => { alive = false; clearTimeout(t); };
  }, [to, anyone, fail]);

  const loadTemplate = useCallback(async (id) => {
    if (!id) { setTpl(null); setTplKeep([]); return; }
    try {
      const { template: t } = await templateGet(id);
      setTpl(t); setTplKeep(t.files.map((f, i) => i));
      setSubject(t.subject); html.current = t.html; setBodyText(t.html); setInitial(t.html); setEdKey((k) => k + 1);
      setCc(t.cc.join(", ")); setBcc(t.bcc.join(", ")); setGreeting(t.greeting);
    } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { if (startTpl) loadTemplate(startTpl.id); }, [startTpl, loadTemplate]);
  const chooseTemplate = async (id) => {
    if ((subject || bodyText) && !(await confirmDialog({ title: "Replace what you wrote?", message: "The subject, message, CC / BCC and attachments of the template replace what is here now.", confirmText: "Use template", tone: "caution" }))) return;
    loadTemplate(id);
  };

  const placeTied = roles.includes("jamaat_coordinator") || roles.includes("jc");
  const jamiatOpts = info.places.map((p) => ({ value: p.jamiat, label: p.jamiat }));
  const jamaatOpts = info.places.filter((p) => !jamiats.length || jamiats.includes(p.jamiat))
    .flatMap((p) => p.jamaats.map((j) => ({ value: `${p.jamiat}\u0000${j}`, label: j, group: p.jamiat })));
  const uploading = files.some((f) => !f.id && !f.error);
  const needForm = usesForm(subject, bodyText);
  const keptFiles = tpl ? tpl.files.filter((f, i) => tplKeep.includes(i)) : [];
  const build = () => ({ subject: subject || "(no subject)", html: html.current, greeting, form: form || undefined });

  const send = async () => {
    if (!preview || !preview.recipients.length) return fail(new Error("Choose who gets this email."));
    if (preview.unknown.length) return fail(new Error(`Not in the portal: ${preview.unknown.join(", ")}. Remove ${preview.unknown.length === 1 ? "it" : "them"}; only portal users can be emailed.`));
    if (!subject.trim()) return fail(new Error("Write a subject."));
    if (!bodyText.replace(/<[^>]*>|&nbsp;/g, "").trim() && !/<img/i.test(bodyText)) return fail(new Error("Write the message."));
    if (needForm && !form) return fail(new Error("The email uses a {{Form …}} variable: choose the form it is about."));
    if (uploading) return fail(new Error("Wait for the attachments to finish uploading."));
    let at = null;
    if (later) {
      if (!sendAt) return fail(new Error("Choose when to send it."));
      at = new Date(sendAt);
      if (at.getTime() < Date.now() + 60000) return fail(new Error("Choose a time at least a minute from now, or send it now."));
    }
    const n = preview.recipients.length;
    const copies = toList(cc).length + toList(bcc).length;
    const ok = await confirmDialog({
      title: later ? "Schedule this email?" : "Send this email?",
      message: [`"${subject.trim()}" goes to ${plural(n, "person", "people")}${later ? ` on ${when(at)}` : " now"}, each with their own details filled in.`,
        ...(copies ? [`CC / BCC (${copies}) get one copy.`] : []),
        ...(keptFiles.length + files.filter((f) => f.id).length ? [`With ${plural(keptFiles.length + files.filter((f) => f.id).length, "attachment")}.`] : []),
        ...(info.ready ? [] : ["Email isn't set up on the server yet, so it will be marked as failed. You can send it again from \"Sent\" once it is set up."])],
      confirmText: later ? "Schedule" : "Send now",
      tone: "info",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await emailSend({
        subject: subject.trim(), html: html.current, to, cc: toList(cc), bcc: toList(bcc), greeting, form: form || undefined,
        files: files.filter((f) => f.id).map((f) => f.id), ...(tpl ? { template: tpl.id, templateFiles: tplKeep } : {}),
        ...(at ? { sendAt: at.toISOString() } : {}),
      });
      onSent(later ? `Scheduled for ${when(r.email.sendAt)}: ${plural(r.email.total, "person", "people")}.` : `Sending to ${plural(r.email.total, "person", "people")}. You can follow it below.`);
    } catch (err) { fail(err); }
    finally { setBusy(false); }
  };

  return (
    <div className="em-grid">
      <section className="panel em-card">
        <div className="panel-head"><div><h2>1. Who gets it</h2><p>Only people who are in the portal can be emailed.</p></div></div>
        <div className="em-body">
          <div className="em-label">Groups</div>
          <div className="em-roles">
            {info.roles.map((r) => (
              <label key={r.value} className={`em-role${roles.includes(r.value) ? " is-on" : ""}`}>
                <input type="checkbox" checked={roles.includes(r.value)} onChange={(e) => setRoles((x) => (e.target.checked ? [...x, r.value] : x.filter((y) => y !== r.value)))} />
                <span>All {r.label}</span><b>{r.count}</b>
              </label>
            ))}
          </div>
          {placeTied && (
            <div className="em-places">
              <div className="em-label">Only in these places <small>(Jamaat Coordinators and JCs; leave empty for everywhere)</small></div>
              <div className="em-row">
                <MultiSelect label="Jamiat" noun="Jamiat" options={jamiatOpts} selected={jamiats}
                  onChange={(v) => { setJamiats(v); setJamaats((x) => x.filter((k) => !v.length || v.includes(k.split("\u0000")[0]))); }} />
                <MultiSelect label="Jamaat" noun="Jamaat" options={jamaatOpts} selected={jamaats} onChange={setJamaats} />
              </div>
            </div>
          )}
          <div className="em-label">Chosen people</div>
          <PeoplePicker people={info.people} picked={picked} setPicked={setPicked} />
          <label className="em-label" htmlFor="em-typed">Gmail addresses <small>(of portal users; separate with commas)</small></label>
          <textarea id="em-typed" className="input em-typed" rows={2} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. name@gmail.com, other@gmail.com" />

          <div className={`em-summary${preview && preview.recipients.length ? " has" : ""}`} aria-live="polite">
            {!anyone ? "Nobody chosen yet."
              : !preview ? "Counting…"
                : <>
                  <b>{plural(preview.recipients.length, "person", "people")}</b> will get this email.
                  {preview.recipients.length > 0 && <button type="button" className="link-btn" onClick={() => setShowList((x) => !x)}>{showList ? "Hide list" : "See who"}</button>}
                </>}
          </div>
          {preview && preview.unknown.length > 0 && <div className="alert em-unknown">Not in the portal (can't be emailed): <b>{preview.unknown.join(", ")}</b></div>}
          {showList && preview && preview.recipients.length > 0 && (
            <div className="em-who">
              {preview.recipients.map((r) => (
                <div key={r.user} className="em-who-row"><b>{r.name || r.email}</b><span>{r.email}</span><span className="pill na">{ROLE_ONE[r.role] || r.role}</span><small>{r.place}</small></div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel em-card">
        <div className="panel-head"><div><h2>2. The email</h2><p>Start from a template, or write it here. {"{{Variables}}"} are filled in for each person.</p></div></div>
        <div className="em-body">
          <div className="em-row em-tpl-row">
            <label className="em-field">
              <span className="em-label">Template</span>
              <select className="input" value={tpl ? tpl.id : ""} onChange={(e) => chooseTemplate(e.target.value)}>
                <option value="">— No template —</option>
                {meta.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="em-field">
              <span className="em-label">Form <small>(for {"{{Form link}}"} and other form variables)</small></span>
              <select className={`input${needForm && !form ? " em-need" : ""}`} value={form} onChange={(e) => setForm(e.target.value)}>
                <option value="">{needForm ? "— Choose the form —" : "— None —"}</option>
                {meta.forms.map((f) => <option key={f.code} value={f.code}>{f.title} ({FORM_STAGE[f.stage] || f.stage})</option>)}
              </select>
            </label>
          </div>
          <div className="em-label-row">
            <label className="em-label" htmlFor="em-subject">Subject</label>
            <select className="re-sel em-subj-var" value="" aria-label="Insert a variable in the subject" onChange={(e) => { if (e.target.value) setSubject((s) => `${s}{{${e.target.value}}}`); }}>
              <option value="" hidden>{"{{ }}"} Insert variable</option>
              {meta.variables.map((v) => <option key={v.key} value={v.key}>{v.group}: {v.key}</option>)}
            </select>
          </div>
          <input id="em-subject" className="input em-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Monthly meeting on Sunday" />
          <div className="em-label">Message</div>
          <RichEditor resetKey={edKey} initialHtml={initial} onChange={(h) => { html.current = h; setBodyText(h); }} variables={meta.variables}
            uploadPublic={emailPublic} onError={(m) => fail(new Error(m))} />
          <label className="em-check"><input type="checkbox" checked={greeting} onChange={(e) => setGreeting(e.target.checked)} /> Start with "Salaam (their name)," <small className="em-muted">(untick if the message has its own greeting)</small></label>
          <CopyFields cc={cc} setCc={setCc} bcc={bcc} setBcc={setBcc} />
          <div className="em-label">Attachments</div>
          <Attachments kept={keptFiles} onDropKept={(i) => { const idx = tplKeep[i]; setTplKeep((k) => k.filter((x) => x !== idx)); }}
            files={files} setFiles={setFiles} maxMb={info.maxAttachMb} onAuthExpired={onAuthExpired} />
        </div>
      </section>

      <section className="panel em-card">
        <div className="panel-head"><div><h2>3. When</h2></div></div>
        <div className="em-body">
          <div className="em-when">
            <label className={`em-opt${!later ? " is-on" : ""}`}><input type="radio" name="em-when" checked={!later} onChange={() => setLater(false)} /> Send now</label>
            <label className={`em-opt${later ? " is-on" : ""}`}><input type="radio" name="em-when" checked={later}
              onChange={() => { setLater(true); if (!sendAt) setSendAt(localInput(new Date(Date.now() + 3600000))); }} /> Schedule for later</label>
            {later && <input type="datetime-local" className="input em-at" value={sendAt} min={localInput(new Date())} onChange={(e) => setSendAt(e.target.value)} aria-label="Send at" />}
          </div>
          {later && <p className="field-hint">In your own time. The server sends it at that moment, even if nobody is signed in.</p>}
          {!info.ready && <div className="alert em-unknown">Email isn't set up on the server yet (no Gmail / SendGrid account), so emails can't go out. The Super Admin can check this under Settings.</div>}
          <div className="em-actions">
            <PreviewButton build={build} people={preview ? preview.recipients : []} fail={fail} />
            <button type="button" className="btn btn-primary" disabled={busy || uploading} onClick={send}><SendIcon /> {busy ? "Saving…" : later ? "Schedule email" : "Send email"}</button>
          </div>
        </div>
      </section>
      <VariableHelp meta={meta} />
    </div>
  );
}

function PeoplePicker({ people, picked, setPicked }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const s = lower(q.trim());
  const matches = s ? people.filter((p) => !picked.includes(p.id) && lower([p.name, p.email, ROLE_ONE[p.role], ...p.places.map((x) => `${x.name} ${x.jamiat}`)].join(" ")).includes(s)).slice(0, 30) : [];
  return (
    <div className="em-people" ref={box}>
      {picked.length > 0 && (
        <div className="em-chips">
          {picked.map((id) => { const p = byId.get(id); if (!p) return null; return (
            <span key={id} className="em-chip">{p.name || p.email} <small>{ROLE_ONE[p.role]}</small>
              <button type="button" onClick={() => setPicked((x) => x.filter((y) => y !== id))} aria-label={`Remove ${p.name || p.email}`}><CloseIcon /></button></span>
          ); })}
        </div>
      )}
      <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Search by name, Gmail, role, Jamaat…" aria-label="Search people" />
      {open && s && (
        <div className="em-drop" role="listbox">
          {matches.length ? matches.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected="false" className="em-drop-row"
              onClick={() => { setPicked((x) => [...x, p.id]); setQ(""); }}>
              <b>{p.name || p.email}</b><span>{p.email}</span>
              <small>{ROLE_ONE[p.role]}{p.places.length === 1 ? ` · ${p.places[0].name} (${p.places[0].jamiat})` : p.places.length ? ` · ${p.places.length} Jamaats` : ""}</small>
            </button>
          )) : <div className="em-drop-none">Nobody found.</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Sent
function Sent({ fail, setMsg }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null); // id
  const load = useCallback(() => emailList().then((r) => setList(r.emails)).catch(fail), [fail]);
  useEffect(() => { load(); }, [load]);
  // Refresh while something is sending (or due).
  const active = (list || []).some((m) => m.status === "sending" || (m.status === "scheduled" && new Date(m.sendAt) <= new Date(Date.now() + 30000)));
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [active, load]);

  if (open) return <SentOne id={open} onBack={() => { setOpen(null); load(); }} fail={fail} setMsg={setMsg} />;
  if (!list) return <div className="panel em-loading">Loading…</div>;
  if (!list.length) return <div className="panel em-loading">No emails yet. Emails you send or schedule appear here.</div>;
  return (
    <section className="panel">
      <div className="table-wrap em-wrap">
        <table className="master-table card-rows em-table">
          <thead><tr><th>Subject</th><th>To</th><th>Status</th><th>Delivered</th><th>When</th><th>By</th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className="em-click" onClick={() => setOpen(m.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpen(m.id); }}>
                <td data-label="Subject"><b>{m.subject}</b>{m.files > 0 && <small className="em-clip"> · {plural(m.files, "attachment")}</small>}</td>
                <td data-label="To">{m.audience}<small className="em-muted"> ({m.total})</small></td>
                <td data-label="Status"><span className={`pill ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span></td>
                <td data-label="Delivered">{m.status === "scheduled" || m.status === "cancelled" ? "—" : <Bar m={m} />}</td>
                <td data-label="When">{when(m.status === "scheduled" ? m.sendAt : m.startedAt || m.sendAt)}{m.status === "scheduled" && <small className="em-muted"> (planned)</small>}</td>
                <td data-label="By">{m.by ? m.by.name || m.by.email : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Bar({ m }) {
  const pct = m.total ? Math.round(((m.sent + m.failed) / m.total) * 100) : 0;
  return (
    <div className="em-bar-wrap" title={`${m.sent} sent, ${m.failed} failed of ${m.total}`}>
      <div className="em-bar"><span className="ok" style={{ width: `${m.total ? (m.sent / m.total) * 100 : 0}%` }} /><span className="bad" style={{ width: `${m.total ? (m.failed / m.total) * 100 : 0}%` }} /></div>
      <small>{m.sent}/{m.total}{m.failed ? <span className="em-fail"> · {m.failed} failed</span> : ""}{m.status === "sending" ? ` · ${pct}%` : ""}</small>
    </div>
  );
}

function SentOne({ id, onBack, fail, setMsg }) {
  const [m, setM] = useState(null);
  const [only, setOnly] = useState("all");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => emailGet(id).then((r) => setM(r.email)).catch(fail), [id, fail]);
  useEffect(() => { load(); }, [load]);
  const live = m && (m.status === "sending" || (m.status === "scheduled" && new Date(m.sendAt) <= new Date(Date.now() + 30000)));
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [live, load]);
  if (!m) return <div className="panel em-loading">Loading…</div>;

  const cancel = async () => {
    if (!(await confirmDialog({ title: "Cancel this email?", message: "It won't be sent. You can write it again later.", confirmText: "Cancel email", tone: "warn" }))) return;
    setBusy(true);
    try { await emailCancel(id); setMsg({ type: "ok", text: "The scheduled email was cancelled." }); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const retry = async () => {
    if (!(await confirmDialog({ title: "Send again?", message: `It is sent again only to ${m.failed ? `the ${plural(m.failed, "person", "people")} it failed for` : "CC / BCC"}.`, confirmText: "Send again", tone: "info" }))) return;
    setBusy(true);
    try { await emailRetry(id); setMsg({ type: "ok", text: "Sending again to those it failed for." }); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const rows = m.recipients.filter((r) => only === "all" || r.status === only);
  const counts = { sent: m.recipients.filter((r) => r.status === "sent").length, failed: m.recipients.filter((r) => r.status === "failed").length, pending: m.recipients.filter((r) => r.status === "pending").length };

  return (
    <div className="em-one">
      <div className="em-one-head">
        <button type="button" className="btn btn-ghost em-back" onClick={onBack}>← All emails</button>
        <div className="em-one-actions">
          {m.status === "scheduled" && <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancel}>Cancel email</button>}
          {(m.status === "done" || m.status === "failed") && (m.failed > 0 || (m.copy && m.copy.status === "failed")) && <button type="button" className="btn btn-primary" disabled={busy} onClick={retry}>Send again to {m.failed ? plural(m.failed, "failed one") : "CC / BCC"}</button>}
        </div>
      </div>
      <section className="panel em-card">
        <div className="em-meta">
          <h2>{m.subject}</h2>
          <div className="em-meta-row">
            <span className={`pill ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>
            <span>To: <b>{m.audience}</b> ({m.total})</span>
            <span>{m.status === "scheduled" ? "Planned for" : "Sent"}: <b>{when(m.status === "scheduled" ? m.sendAt : m.startedAt || m.sendAt)}</b></span>
            {m.by && <span>By: <b>{m.by.name || m.by.email}</b></span>}
            {m.cancelledBy && <span>Cancelled by: <b>{m.cancelledBy.name || m.cancelledBy.email}</b></span>}
            {m.templateName && <span>Template: <b>{m.templateName}</b></span>}
            {m.form && <span>Form: <b>{m.form.title}</b></span>}
          </div>
          <div className="em-meta-row">
            {m.cc.length > 0 && <span>CC: <b>{m.cc.join(", ")}</b></span>}
            {m.bcc.length > 0 && <span>BCC: <b>{m.bcc.join(", ")}</b></span>}
            {m.copy && <span>CC / BCC copy: <span className={`pill ${m.copy.status === "sent" ? "good" : m.copy.status === "failed" ? "bad" : "na"}`}>{m.copy.status === "sent" ? "Sent" : m.copy.status === "failed" ? "Failed" : "Waiting"}</span>{m.copy.error ? <small className="em-fail"> {m.copy.error}</small> : ""}</span>}
          </div>
          {m.status !== "scheduled" && m.status !== "cancelled" && <Bar m={m} />}
        </div>
        <div className="em-preview">
          {m.greeting && <div className="em-preview-hello">Salaam (name),</div>}
          {/* Already cleaned on the server: only safe formatting is kept. */}
          <div className="em-preview-body" dangerouslySetInnerHTML={{ __html: m.html }} />
          {m.attachments.length > 0 && (
            <div className="em-files">
              {m.attachments.map((a, i) => (
                <a key={i} className="em-file" href={a.url || undefined} target="_blank" rel="noopener noreferrer"><span className="em-file-name">{a.name}</span><small>{size(a.size || 0)}</small></a>
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Who got it</h2></div>
          <div className="cp-tabs em-filter" role="tablist">
            {[["all", `All ${m.recipients.length}`], ["sent", `Sent ${counts.sent}`], ["failed", `Failed ${counts.failed}`], ...(counts.pending ? [["pending", `Waiting ${counts.pending}`]] : [])].map(([k, l]) => (
              <button key={k} type="button" className={only === k ? "is-on" : ""} onClick={() => setOnly(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="master-table card-rows em-table">
            <thead><tr><th>Name</th><th>Gmail</th><th>Role</th><th>Jamaat</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td data-label="Name"><b>{r.name || "—"}</b></td>
                  <td data-label="Gmail">{r.email}</td>
                  <td data-label="Role">{ROLE_ONE[r.role] || r.role}</td>
                  <td data-label="Jamaat">{r.place || "—"}</td>
                  <td data-label="Result">
                    {r.status === "sent" ? <><span className="pill good">Sent</span> <small className="em-muted">{when(r.sentAt)}{r.provider ? ` · ${r.provider === "sendgrid" ? "SendGrid" : "Nodemailer"}` : ""}</small></>
                      : r.status === "failed" ? <><span className="pill bad">Failed</span> <small className="em-fail">{r.error}</small></>
                        : <span className="pill na">Waiting</span>}
                    {r.status === "sent" && r.error && <div><small className="em-muted">{r.error}</small></div>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="em-muted">Nobody here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Settings (Super Admin)
function Settings({ fail, setMsg }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => { emailProviders().then(setS).catch(fail); }, [fail]);
  if (!s) return <div className="panel em-loading">Loading…</div>;
  const use = async (p) => {
    setBusy(`use-${p.name}`);
    try { setS(await emailSetProvider(p.name)); setMsg({ type: "ok", text: `Emails are now sent with ${p.label}.` }); } catch (e) { fail(e); } finally { setBusy(""); }
  };
  const test = async (p) => {
    setBusy(`test-${p.name}`);
    try { const r = await emailTest(p.name); setMsg({ type: "ok", text: `A test email was sent with ${p.label} to ${r.to}. Check your inbox (and spam).` }); } catch (e) { fail(e); } finally { setBusy(""); }
  };
  const NEEDS = {
    nodemailer: ["SMTP_USER (the Gmail address)", "SMTP_PASS (a Gmail app password)", "EMAIL_FROM (optional, e.g. Umoor Sehhat <name@gmail.com>)"],
    sendgrid: ["SENDGRID_API_KEY", "SENDGRID_FROM (a sender verified in SendGrid)"],
  };
  return (
    <>
      {s.testing && <div className="alert info em-unknown">The server is in testing mode (EMAIL_PROVIDER=log): emails are only printed, not sent.</div>}
      <div className="em-provs">
        {s.providers.map((p) => {
          const on = s.active === p.name;
          return (
            <section key={p.name} className={`panel em-prov${on ? " is-on" : ""}`}>
              <div className="em-prov-head">
                <h2>{p.label}</h2>
                {on && <span className="pill good">In use</span>}
                {p.name === s.fallback && <span className="pill info">Backup</span>}
              </div>
              <p className="em-prov-sub">{p.name === "nodemailer"
                ? "Free. Sends through a Gmail account (about 500 emails a day; Google Workspace about 2000). Always the backup: if the other service fails, emails go out through this one."
                : "Paid service for larger volumes. If it fails (e.g. unpaid or limit reached), the email is sent through Nodemailer instead."}</p>
              <div className={`em-prov-state${p.configured ? " ok" : ""}`}>
                {p.configured ? <>✓ Set up on the server{p.from ? <> · sends as <b>{p.from}</b></> : ""}</> : <>Not set up on the server. Add these on Render: <ul>{NEEDS[p.name].map((x) => <li key={x}><code>{x}</code></li>)}</ul></>}
              </div>
              <div className="em-prov-actions">
                {!on && <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => use(p)}>{busy === `use-${p.name}` ? "Switching…" : "Use this"}</button>}
                <button type="button" className="btn btn-ghost" disabled={!!busy || !p.configured} onClick={() => test(p)}>{busy === `test-${p.name}` ? "Sending…" : "Send me a test email"}</button>
              </div>
            </section>
          );
        })}
      </div>
      <p className="field-hint em-note">Passwords and API keys are kept only in the server settings (Render), never in the portal. Switching here takes effect at once for every email: Send email, form emails and reminders.</p>
    </>
  );
}
