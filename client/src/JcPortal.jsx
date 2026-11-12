import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthError, isServerStarting, portalEntry, portalOptions, portalSave } from "./lib/api";
import { ChevronRight, LockIcon } from "./components/Icons";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";

const LAST_JAMIAT = "jc-portal:jamiat";
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

// details = the Jamaat's Mauze Type / House Count. They are locked here (only the Super Admin
// changes them in Masters); they are sent back as shown, and the server refuses + logs any change.
const blankForm = (details) => ({
  values: {},
  comments: {},
  remarks: "",
  details: {
    mauzeType: details.mauzeType || "",
    houseCount: details.houseCount == null ? "" : String(details.houseCount),
  },
});

// Today in the browser's time zone, as YYYY-MM-DD (the latest date a JC can pick).
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmtTime = (d) =>
  new Date(d).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Public form where a JC fills one Jamaat's monthly follow-up.
export default function JcPortal({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const expiredRef = useRef(onAuthExpired);
  expiredRef.current = onAuthExpired;
  const [opts, setOpts] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [month, setMonth] = useState("");
  const [jamiatId, setJamiatId] = useState("");
  const [jamaatId, setJamaatId] = useState("");

  const [form, setForm] = useState(null);       // what is on screen
  const [baseline, setBaseline] = useState(""); // JSON of the last loaded/saved form (unsaved-changes check)
  const [savedAt, setSavedAt] = useState(null); // when this Jamaat's month was last saved
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    const before = document.title;
    document.title = "JC Portal · Umoor Sehhat";
    return () => { document.title = before; };
  }, []);

  // ---- load the lists (retry while the server wakes up) ----
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const load = () =>
      portalOptions()
        .then((o) => {
          if (!alive) return;
          setOpts(o);
          setMonth(o.months[0] ? o.months[0].key : "");
          const last = store.get(LAST_JAMIAT);
          if (o.jamiats.some((j) => j.id === last)) setJamiatId(last);
        })
        .catch((err) => {
          if (!alive) return;
          if (err instanceof AuthError) return expiredRef.current();
          if (isServerStarting(err) && tries++ < 24) {
            setLoadMsg("Connecting to the server…");
            setTimeout(load, 5000);
          } else setLoadMsg(err.message);
        });
    load();
    return () => { alive = false; };
  }, []);

  const jamiat = opts ? opts.jamiats.find((j) => j.id === jamiatId) : null;
  const jamaats = jamiat ? jamiat.jamaats : [];
  const jamaat = jamaats.find((x) => x.id === jamaatId) || null;
  const monthLabel = opts ? (opts.months.find((m) => m.key === month) || {}).label : "";
  const dirty = !!form && JSON.stringify(form) !== baseline;

  // ---- load what is saved for the chosen Jamaat + month ----
  useEffect(() => {
    if (!jamaatId || !month) { setForm(null); setBaseline(""); setSavedAt(null); return; }
    let alive = true;
    setEntryLoading(true);
    setError("");
    setShowMissing(false);
    portalEntry(jamaatId, month)
      .then(({ details, entry }) => {
        if (!alive) return;
        const f = blankForm(details);
        if (entry) { f.values = { ...entry.values }; f.comments = { ...(entry.comments || {}) }; f.remarks = entry.remarks || ""; }
        setForm(f);
        setBaseline(JSON.stringify(f));
        setSavedAt(entry ? entry.updatedAt : null);
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof AuthError) return expiredRef.current();
        setForm(null);
        setError(err.message);
      })
      .finally(() => { if (alive) setEntryLoading(false); });
    return () => { alive = false; };
  }, [jamaatId, month]);

  // Warn before closing the tab with unsaved answers.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const okToLeave = () => !dirty || window.confirm(`You have unsaved answers for ${jamaat ? jamaat.name : "this Jamaat"}. Discard them?`);

  const chooseMonth = (v) => { if (okToLeave()) { setMonth(v); setSuccess(""); } };
  const chooseJamiat = (v) => {
    if (!okToLeave()) return;
    setJamiatId(v); setJamaatId(""); setSuccess("");
    if (v) store.set(LAST_JAMIAT, v);
  };
  const chooseJamaat = (v) => { if (okToLeave()) { setJamaatId(v); setSuccess(""); } };

  const setValue = (key, v) => setForm((f) => ({ ...f, values: { ...f.values, [key]: v } }));
  // The detail fields are disabled; if someone re-enables one in the browser, the change is sent
  // and the server refuses the save and logs the attempt.
  const setDetail = (key, v) => setForm((f) => ({ ...f, details: { ...f.details, [key]: v } }));
  const setComment = (key, v) => setForm((f) => ({ ...f, comments: { ...f.comments, [key]: v } }));

  const groups = useMemo(() => {
    if (!opts) return [];
    const out = [];
    for (const f of opts.fields) {
      let g = out.find((x) => x.name === f.group);
      if (!g) out.push((g = { name: f.group, fields: [] }));
      g.fields.push(f);
    }
    return out;
  }, [opts]);

  const requiredFields = opts ? opts.fields.filter((f) => f.required) : [];
  const answered = form ? requiredFields.filter((f) => form.values[f.key]).length : 0;
  const total = requiredFields.length;
  const index = jamaats.findIndex((x) => x.id === jamaatId);
  const nextJamaat = index > -1 ? jamaats[index + 1] : null;

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const missing = opts.fields.filter((f) => f.required && !form.values[f.key]);
    if (missing.length) {
      setShowMissing(true);
      setError(`Please answer: ${missing.map((f) => f.label).join(" · ")}`);
      const el = document.getElementById(`q-${missing[0].key}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSaving(true);
    try {
      // Send only answers to the questions currently on the form.
      const values = {};
      const comments = {};
      for (const f of opts.fields) {
        if (form.values[f.key]) values[f.key] = form.values[f.key];
        if (f.hasComment && (form.comments[f.key] || "").trim()) comments[f.key] = form.comments[f.key];
      }
      const res = await portalSave({
        month, jamaatId, values, comments, remarks: form.remarks,
        details: form.details, // locked: sent as shown so the server can check nothing was changed
      });
      const f = { ...form, details: blankForm(res.details).details };
      setForm(f);
      setBaseline(JSON.stringify(f));
      setSavedAt(res.updatedAt);
      setShowMissing(false);
      setSuccess(`${res.firstSubmission ? "Saved" : "Updated"} ${jamaat.name} for ${monthLabel}.`);
    } catch (err) {
      if (err instanceof AuthError) return expiredRef.current();
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [opts, form, month, jamaatId, jamaat, monthLabel]);

  return (
    <div className="portal">
      <AppBar title="JC Portal" subtitle="Monthly Jamaat follow-up" theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />

      <main className="container portal-main">
        {!opts ? (
          <div className="panel portal-empty">{loadMsg}</div>
        ) : (
          <>
            {!opts.jamiats.length && (
              <div className="panel portal-empty">No Jamaats are assigned to you yet. Please contact the Super Admin.</div>
            )}
            <section className="panel portal-pick" aria-label="Choose the Jamaat">
              <div className="portal-step"><span className="step-no">1</span> Choose the Jamaat</div>
              <div className="pick-grid">
                <label className="field">
                  <span className="field-label">Month</span>
                  <select value={month} onChange={(e) => chooseMonth(e.target.value)}>
                    {opts.months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Jamiat</span>
                  <select value={jamiatId} onChange={(e) => chooseJamiat(e.target.value)}>
                    <option value="">Select Jamiat…</option>
                    {opts.jamiats.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Jamaat</span>
                  <select value={jamaatId} onChange={(e) => chooseJamaat(e.target.value)} disabled={!jamiat}>
                    <option value="">{jamiat ? "Select Jamaat…" : "Select a Jamiat first"}</option>
                    {jamaats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              </div>
            </section>

            {!form && <Notice type="error" text={error} onClose={() => setError("")} />}

            {jamaat && entryLoading && <div className="panel portal-empty">Loading {jamaat.name}…</div>}

            {jamaat && form && !entryLoading && (
              <form onSubmit={submit} noValidate>
                <div className={`entry-state${savedAt ? " is-saved" : ""}`} role="status">
                  {savedAt
                    ? <>Last saved on <b>{fmtTime(savedAt)}</b>. Change any answer and save again to update it.</>
                    : <>Not submitted yet for <b>{monthLabel}</b>.</>}
                </div>

                <section className="panel form-section">
                  <div className="portal-step"><span className="step-no">2</span> Jamaat details</div>
                  <div className="details-grid">
                    <label className="field">
                      <span className="field-label">Mauze Type <LockIcon /></span>
                      <select value={form.details.mauzeType} disabled aria-readonly="true" onChange={(e) => setDetail("mauzeType", e.target.value)}>
                        <option value={form.details.mauzeType}>{form.details.mauzeType || "Not set"}</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">House Count <LockIcon /></span>
                      <input className="input" value={form.details.houseCount} placeholder="Not set" readOnly disabled aria-readonly="true"
                        onChange={(e) => setDetail("houseCount", e.target.value)} />
                    </label>
                  </div>
                  <p className="locked-note">These details can be changed only by the Super Admin.</p>
                </section>

                <section className="panel form-section">
                  <div className="portal-step"><span className="step-no">3</span> Monthly follow-up · {monthLabel}</div>
                  {groups.map((g) => (
                    <div className="q-group" key={g.name}>
                      <div className="eyebrow q-group-name">{g.name}</div>
                      {g.fields.map((f) => {
                        const value = form.values[f.key] || "";
                        const missing = showMissing && !value;
                        return (
                          <fieldset className={`q${missing ? " is-missing" : ""}`} key={f.key} id={`q-${f.key}`}>
                            <legend className="q-label">
                              {f.label}
                              {!f.required && <span className="optional">(optional)</span>}
                              {missing && <span className="q-req">Required</span>}
                            </legend>
                            {f.type === "date" ? (
                              <div className="date-line">
                                <input className="input date-input" type="date" min="2020-01-01" max={today()} value={value}
                                  onChange={(e) => setValue(f.key, e.target.value)} aria-label={f.label} />
                                {!f.required && value && (
                                  <button type="button" className="seg-clear" onClick={() => setValue(f.key, "")}>Clear</button>
                                )}
                              </div>
                            ) : (
                              <div className="seg-control">
                                {f.options.map((o) => (
                                  <label key={o.value} className={`seg-opt tone-${o.tone}${value === o.value ? " is-on" : ""}`}>
                                    <input type="radio" name={f.key} value={o.value} checked={value === o.value} onChange={() => setValue(f.key, o.value)} />
                                    <span>{o.value}</span>
                                  </label>
                                ))}
                                {!f.required && value && (
                                  <button type="button" className="seg-clear" onClick={() => setValue(f.key, "")}>Clear</button>
                                )}
                              </div>
                            )}
                            {f.hasComment && (
                              <textarea className="input q-comment" rows={2} maxLength={opts.commentMaxLength}
                                placeholder="Comment (optional)" aria-label={`Comment for ${f.label}`}
                                value={form.comments[f.key] || ""} onChange={(e) => setComment(f.key, e.target.value)} />
                            )}
                          </fieldset>
                        );
                      })}
                    </div>
                  ))}

                  <label className="field remarks-field">
                    <span className="field-label">{opts.remarksLabel} <span className="optional">(optional)</span></span>
                    <textarea className="input" rows={3} maxLength={opts.remarksMaxLength}
                      placeholder="Add a short note only when needed"
                      value={form.remarks} onChange={(e) => setForm((x) => ({ ...x, remarks: e.target.value }))} />
                    <span className="char-count">{form.remarks.length}/{opts.remarksMaxLength}</span>
                  </label>
                </section>

                <Notice type="error" text={error} onClose={() => setError("")} />
                <Notice type="ok" text={success} onClose={() => setSuccess("")}>
                  {nextJamaat && (
                    <button type="button" className="btn btn-ghost" onClick={() => { setJamaatId(nextJamaat.id); setSuccess(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                      Next: {nextJamaat.name} <ChevronRight size={14} />
                    </button>
                  )}
                </Notice>

                <div className="save-bar">
                  <div className="save-progress">
                    <b>{answered}</b> of {total} required answered
                    {dirty && <span className="unsaved">· unsaved changes</span>}
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? "Saving…" : savedAt ? "Save changes" : "Submit"}
                  </button>
                </div>
              </form>
            )}

            {!jamaat && (
              <div className="panel portal-empty">Select the month, Jamiat and Jamaat to fill the form.</div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
