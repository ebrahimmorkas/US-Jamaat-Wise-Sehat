import { useCallback, useEffect, useRef, useState } from "react";
import FormView, { fmtWhen, myZone, phoneOk, phoneValue } from "./components/FormView";
import LoginPage from "./components/LoginPage";
import { CheckIcon, ClockIcon, InfoIcon, LockIcon, MoonIcon, SunIcon, WarnIcon } from "./components/Icons";
import { fillGet, fillSubmit, fillUpload, isServerStarting } from "./lib/api";
import { useAuth } from "./hooks/useAuth";

// Filling a form: /f/<id>?t=<personal link>. Works without signing in for "personal link" and
// "anyone" forms; "sign in" forms (and forms in Testing) show the Google sign-in here.
const keyStore = (id) => `form-edit:${id}`;
const readKey = (id) => { try { return localStorage.getItem(keyStore(id)) || ""; } catch { return ""; } };
const saveKey = (id, k) => { try { localStorage.setItem(keyStore(id), k); } catch { /* private mode */ } };

const MESSAGES = {
  NOT_STARTED: { icon: <ClockIcon />, title: "This form isn't open yet" },
  CLOSED: { icon: <LockIcon />, title: "This form is closed" },
  BAD_LINK: { icon: <WarnIcon />, title: "This link isn't valid" },
  NOT_TESTER: { icon: <InfoIcon />, title: "This form is being tested" },
  NOT_ALLOWED: { icon: <InfoIcon />, title: "This form isn't for this account" },
  NOT_FOUND: { icon: <WarnIcon />, title: "Form not found" },
};

export default function FormFillPage({ id, theme, onToggleTheme }) {
  const auth = useAuth();
  const t = new URLSearchParams(window.location.search).get("t") || "";
  const [data, setData] = useState(null); // { form, me, used, remaining, mine }
  const [stop, setStop] = useState(null); // { code, error, form?, startAt?, endAt? }
  const [values, setValues] = useState({});
  const [email, setEmail] = useState("");
  const [problems, setProblems] = useState({});
  const [editing, setEditing] = useState(null); // response id being edited
  const [done, setDone] = useState(null); // { edited }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const uploads = useRef(0);

  const load = useCallback(async (tries = 0) => {
    try {
      const d = await fillGet(id, t, readKey(id));
      setData(d); setStop(null); setError("");
      setEmail((e) => e || d.me.email || "");
    } catch (err) {
      if (isServerStarting(err) && tries < 24) { setTimeout(() => load(tries + 1), 5000); return; }
      if (err.data && err.data.code) setStop({ code: err.data.code, error: err.message, ...err.data });
      else setError(err.message);
    }
  }, [id, t]);
  // Wait for the sign-in check, so a signed-in person is recognised.
  useEffect(() => { if (auth.status !== "checking") load(); }, [auth.status, load]);

  useEffect(() => {
    const before = document.title;
    const title = (data && data.form.title) || (stop && stop.form && stop.form.title);
    if (title) document.title = `${title} · Umoor Sehhat`;
    return () => { document.title = before; };
  }, [data, stop]);

  // Leaving with typed answers asks first.
  const dirty = !!data && !done && Object.keys(values).length > 0;
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const set = (key, v) => {
    setValues((s) => ({ ...s, [key]: v }));
    if (problems[key]) setProblems((p) => {
      const n = { ...p }; delete n[key];
      if (!Object.values(n).some(Boolean)) setError(""); // every highlighted answer fixed
      return n;
    });
  };

  const onUpload = async (f, file) => {
    const tmp = `tmp-${Math.random().toString(36).slice(2)}`;
    const preview = f.type === "image" || f.type === "video" ? URL.createObjectURL(file) : "";
    const patch = (fn) => setValues((s) => ({ ...s, [f.key]: (s[f.key] || []).map((x) => (x.tmp === tmp ? fn(x) : x)) }));
    const ext = (/\.([a-z0-9]+)$/i.exec(file.name) || [])[1];
    const bad = !ext || !(f.accept || []).includes(ext.toLowerCase()) ? `This type of file isn't allowed here (${(f.accept || []).join(", ")}).`
      : file.size > f.maxMb * 1024 * 1024 ? `Too large: the limit is ${f.maxMb} MB.` : "";
    setValues((s) => ({ ...s, [f.key]: [...(s[f.key] || []), { tmp, name: file.name, size: file.size, preview, progress: bad ? null : 0, error: bad }] }));
    if (bad) return;
    uploads.current += 1;
    try {
      const up = await fillUpload(id, f.key, t, file, (p) => patch((x) => ({ ...x, progress: Math.min(p, 0.99) })));
      patch((x) => ({ ...x, id: up.id, token: up.token, progress: 1 }));
    } catch (err) {
      patch((x) => ({ ...x, error: err.message, progress: null }));
    } finally { uploads.current -= 1; }
  };
  const onRemoveFile = (f, item) => {
    if (item.preview) URL.revokeObjectURL(item.preview);
    setValues((s) => ({ ...s, [f.key]: (s[f.key] || []).filter((x) => x !== item) }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (uploads.current > 0) return setError("Please wait until the files finish uploading.");
    const form = data.form;
    // Quick checks here; the server checks everything again.
    const p = {};
    for (const f of form.fields) {
      const v = values[f.key];
      if (["heading", "paragraph"].includes(f.type)) continue;
      const empty = v == null || v === "" || (Array.isArray(v) && !v.length) || (f.type === "phone" && !phoneValue(v));
      if (Array.isArray(v) && v.some((x) => x.error)) p[f.key] = "Remove the file that couldn't be uploaded.";
      else if (f.required && empty) p[f.key] = "This question needs an answer.";
      else if (f.type === "phone" && !empty && !phoneOk(v)) p[f.key] = "Enter a valid phone number for the chosen country.";
    }
    if (data.me.needEmail && !editing && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) p._email = "Enter a valid email address.";
    if (Object.keys(p).length) return showProblems(p);
    const answers = {};
    for (const f of form.fields) {
      const v = values[f.key];
      if (v == null || v === "") continue;
      if (f.type === "phone") { const ph = phoneValue(v); if (ph) answers[f.key] = ph; continue; }
      answers[f.key] = Array.isArray(v) && ["image", "video", "file"].includes(f.type) ? v.map((x) => (x.token ? { id: x.id, token: x.token } : { id: x.id })) : v;
    }
    setBusy(true); setError("");
    try {
      const r = await fillSubmit(id, { t, email: email.trim(), answers, ...(editing ? { responseId: editing, editKey: readKey(id) } : {}) });
      if (r.editKey) saveKey(id, r.editKey);
      setDone({ edited: !!r.edited });
      window.scrollTo(0, 0);
    } catch (err) {
      if (err.data && err.data.problems) showProblems(err.data.problems);
      else setError(err.message);
    } finally { setBusy(false); }
  };
  const showProblems = (p) => {
    setProblems(p);
    setError(`Please check ${Object.keys(p).length === 1 ? "the highlighted answer" : `the ${Object.keys(p).length} highlighted answers`}.`);
    const first = data.form.fields.find((f) => p[f.key]);
    const el = document.getElementById(p._email ? "fv-email" : first ? `q-${first.key}` : "");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const startEdit = (r) => {
    setEditing(r.id);
    setValues(r.answers || {});
    setProblems({}); setError(""); setDone(null);
    window.scrollTo(0, 0);
  };
  const again = () => { setValues({}); setEditing(null); setDone(null); setProblems({}); load(); };

  // ---------- pages ----------
  const shell = (body) => (
    <div className="fill-shell">
      <div className="fill-top">
        <span className="fill-brand"><img src="/logo.png" alt="" /> Umoor Sehhat</span>
        <button type="button" className={`icon-toggle${theme === "dark" ? " is-dark" : ""}`} onClick={onToggleTheme} aria-label="Switch theme">
          <span className="sun"><SunIcon /></span><span className="moon"><MoonIcon /></span>
        </button>
      </div>
      <main className="fill-main">{body}</main>
    </div>
  );

  if (auth.status === "checking" || (!data && !stop && !error)) return shell(<div className="panel portal-empty">Loading the form…</div>);

  if (stop && stop.code === "NEED_LOGIN" && auth.status !== "authed") {
    return (
      <>
        <div className="fill-login-note">{stop.form && stop.form.title ? <><b>{stop.form.title}</b><br /></> : null}{stop.error}</div>
        <LoginPage onGoogle={auth.signInGoogle} onDev={auth.signInDev} message={auth.message} theme={theme} onToggleTheme={onToggleTheme} />
      </>
    );
  }
  if (stop) {
    const m = MESSAGES[stop.code] || { icon: <WarnIcon />, title: "This form can't be filled" };
    return shell(
      <div className="panel fill-msg">
        {stop.form && stop.form.topImage && <img className="fv-top" src={stop.form.topImage} alt="" />}
        <div className="fill-msg-body">
          <span className="fill-msg-icon">{m.icon}</span>
          {stop.form && stop.form.title && <p className="fill-msg-form">{stop.form.title}</p>}
          <h1>{m.title}</h1>
          <p>{stop.error}</p>
          {stop.code === "NOT_STARTED" && stop.startAt && <p className="fill-when">Opens <b>{fmtWhen(stop.startAt)}</b> <span className="muted">(your time{myZone() ? `, ${myZone()}` : ""})</span></p>}
          {stop.code === "CLOSED" && stop.endAt && <p className="fill-when muted">Closed {fmtWhen(stop.endAt)} (your time)</p>}
          {auth.status === "authed" && ["NOT_TESTER", "NOT_ALLOWED"].includes(stop.code) && (
            <p className="muted">Signed in as {auth.user.email}. <button type="button" className="link-btn" onClick={() => auth.signOut().then(() => load())}>Sign out</button></p>
          )}
        </div>
      </div>
    );
  }
  if (!data) return shell(<div className="panel fill-msg"><div className="fill-msg-body"><h1>Couldn't load the form</h1><p>{error}</p><button type="button" className="btn btn-primary" onClick={() => load()}>Try again</button></div></div>);

  const { form, me } = data;
  if (done) {
    const left = data.remaining == null ? null : data.remaining - (done.edited ? 0 : 1);
    return shell(
      <div className="panel fill-msg">
        {form.topImage && <img className="fv-top" src={form.topImage} alt="" />}
        <div className="fill-msg-body">
          <span className="fill-msg-icon good"><CheckIcon /></span>
          <p className="fill-msg-form">{form.title}</p>
          <h1>{done.edited ? "Your changes are saved" : "Thank you! Your response is sent"}</h1>
          {me.isTest && <p className="pill warn">Test response</p>}
          {form.allowEdit && <p className="muted">You can change it until {fmtWhen(form.endAt)} (your time).</p>}
          <div className="fill-actions">
            {form.allowEdit && <button type="button" className="btn btn-ghost" onClick={again}>See / change my response</button>}
            {(left == null || left > 0) && <button type="button" className="btn btn-primary" onClick={again}>Fill again</button>}
          </div>
        </div>
      </div>
    );
  }

  const full = data.remaining === 0 && !editing;
  if (full) {
    // Nothing more to fill: say so (and offer to change a response when the form allows it).
    return shell(
      <div className="panel fill-msg">
        {form.topImage && <img className="fv-top" src={form.topImage} alt="" />}
        <div className="fill-msg-body">
          <span className="fill-msg-icon good"><CheckIcon /></span>
          <p className="fill-msg-form">{form.title}</p>
          <h1>You have already filled this form</h1>
          <p>{data.used > 1 ? `You filled it ${data.used} times (the limit is ${form.maxPerPerson}).` : "Thank you, your response was received."}</p>
          {me.isTest && <p className="pill warn">Test responses</p>}
          {data.mine.length > 0 && (
            <ul className="fill-mine-list">
              {data.mine.map((r) => (
                <li key={r.id}><span>Sent {fmtWhen(r.submittedAt)}{r.editedAt ? ` · changed ${fmtWhen(r.editedAt)}` : ""}</span>
                  <button type="button" className="btn btn-primary" onClick={() => startEdit(r)}>Change my response</button></li>
              ))}
            </ul>
          )}
          {form.allowEdit && data.mine.length > 0 && <p className="muted">You can change it until {fmtWhen(form.endAt)} (your time).</p>}
        </div>
      </div>
    );
  }
  return shell(
    <form className="fill-form" onSubmit={submit} noValidate>
      {me.isTest && <div className="alert info notice fill-test"><InfoIcon /><span className="notice-text"><b>Testing.</b> Only testers can fill this form now. What you send is saved as a test response.</span></div>}
      <div className="panel fill-who" id="fv-email">
        {me.needEmail ? (
          <label className="field fill-email">
            <span className="field-label">Your email <span className="fv-star">*</span></span>
            <input className="input" type="email" inputMode="email" autoComplete="email" value={email} disabled={!!editing}
              onChange={(e) => { setEmail(e.target.value); if (problems._email) setProblems((p) => ({ ...p, _email: undefined })); }} placeholder="name@example.com" />
            {problems._email && <span className="fv-problem">{problems._email}</span>}
            {form.sendCopy && <span className="field-hint">A copy of your response is sent to this email.</span>}
          </label>
        ) : (
          <p className="fill-as"><LockIcon /> Filling as <b>{me.email}</b>{me.name ? ` (${me.name})` : ""}{me.jamaat ? ` · ${me.jamaat}` : ""}
            {form.sendCopy && <span className="muted"> — a copy of your response is sent to this email.</span>}</p>
        )}
        <p className="fill-close muted">Closes {fmtWhen(form.endAt)} <span>(your time{myZone() ? `, ${myZone()}` : ""})</span>
          {form.maxPerPerson != null && <> · You can fill it {form.maxPerPerson === 1 ? "once" : `${form.maxPerPerson} times`}{data.used ? ` (used ${data.used})` : ""}</>}</p>
      </div>

      <div className="panel fv-card">
        <FormView form={form} values={values} onChange={set} problems={problems} onUpload={onUpload} onRemoveFile={onRemoveFile} locked={busy || full} />
      </div>

      {data.mine.length > 0 && (
        <div className="panel fill-mine">
          <h2>Your responses</h2>
          <ul>
            {data.mine.map((r) => (
              <li key={r.id} className={editing === r.id ? "is-on" : ""}>
                <span>Sent {fmtWhen(r.submittedAt)}{r.editedAt ? ` · changed ${fmtWhen(r.editedAt)}` : ""}</span>
                {editing === r.id ? <span className="pill info">Editing</span>
                  : <button type="button" className="mini-btn" onClick={() => startEdit(r)}>Change</button>}
              </li>
            ))}
          </ul>
          {editing && <button type="button" className="link-btn" onClick={again}>Stop editing</button>}
        </div>
      )}

      {error && <div className="alert notice" role="alert"><span className="notice-text">{error}</span></div>}
      {full ? (
        <div className="alert info notice"><span className="notice-text">You have already filled this form{data.used > 1 ? ` ${data.used} times` : ""}{form.allowEdit && data.mine.length ? ". You can change your response above." : "."}</span></div>
      ) : (
        <div className="fill-submit">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : editing ? "Save changes" : "Send"}</button>
          {form.access === "personal_link" && <span className="muted">Don't share your personal link: anyone with it can fill as you.</span>}
        </div>
      )}
    </form>
  );
}
