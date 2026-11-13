import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthError, isServerStarting, portalEntry, portalOptions, portalSave } from "./lib/api";
import { ChevronRight, LockIcon } from "./components/Icons";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { confirmDialog } from "./components/ConfirmDialog";
import MonthYearPicker from "./components/MonthYearPicker";
import { JC_NAV } from "./JcDashboard";
import { Link } from "./lib/router";

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

// Where one activity's answer is saved: "<question key>:<activity id>".
const actKey = (key, id) => `${key}:${id}`;

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
  const [activities, setActivities] = useState({}); // this month's activities: { <question key>: [{ id, name }] }
  const [actPick, setActPick] = useState({});       // activity chosen in each activity question: { <question key>: id }
  const [baseline, setBaseline] = useState(""); // JSON of the last loaded/saved form (unsaved-changes check)
  const [savedAt, setSavedAt] = useState(null); // when this Jamaat's month was last saved
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    const before = document.title;
    document.title = "Fill form · JC Portal";
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
          // Opened from the dashboard ("Fill" / "Update"): ?jamaat=<id>&month=YYYY-MM
          const params = new URLSearchParams(window.location.search);
          const wantMonth = params.get("month");
          const wantJamaat = params.get("jamaat");
          const owner = wantJamaat && o.jamiats.find((j) => j.jamaats.some((x) => x.id === wantJamaat));
          setMonth(o.months.some((m) => m.key === wantMonth) ? wantMonth : o.months[0] ? o.months[0].key : "");
          if (owner) {
            setJamiatId(owner.id);
            setJamaatId(wantJamaat);
            store.set(LAST_JAMIAT, owner.id);
          } else {
            const last = store.get(LAST_JAMIAT);
            if (o.jamiats.some((j) => j.id === last)) setJamiatId(last);
          }
          if (window.location.search) window.history.replaceState(null, "", "/jc-portal/form");
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
      .then(({ details, entry, activities: acts = {} }) => {
        if (!alive) return;
        const f = blankForm(details);
        if (entry) { f.values = { ...entry.values }; f.comments = { ...(entry.comments || {}) }; f.remarks = entry.remarks || ""; }
        setActivities(acts);
        // Start each activity question on the first activity not answered yet.
        setActPick(Object.fromEntries(Object.entries(acts).map(([k, list]) => {
          const next = list.find((a) => !f.values[actKey(k, a.id)]) || list[0];
          return [k, next ? next.id : ""];
        })));
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

  // (Closing / reloading the browser tab still uses the browser's own warning above; browsers don't allow a custom one there.)
  const okToLeave = async () => !dirty || confirmDialog({
    tone: "caution", title: "Discard unsaved answers?", confirmText: "Discard", cancelText: "Keep editing",
    message: `You have unsaved answers for ${jamaat ? jamaat.name : "this Jamaat"}. If you continue, they will be lost.`,
  });

  const chooseMonth = async (v) => { if (await okToLeave()) { setMonth(v); setSuccess(""); } };
  const chooseJamiat = async (v) => {
    if (!(await okToLeave())) return;
    setJamiatId(v); setJamaatId(""); setSuccess("");
    if (v) store.set(LAST_JAMIAT, v);
  };
  const chooseJamaat = async (v) => { if (await okToLeave()) { setJamaatId(v); setSuccess(""); } };

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

  // Activity questions are answered per activity, as each one is done (never required).
  const requiredFields = opts ? opts.fields.filter((f) => f.required && !f.hasActivities) : [];
  const answered = form ? requiredFields.filter((f) => form.values[f.key]).length : 0;
  const total = requiredFields.length;
  const index = jamaats.findIndex((x) => x.id === jamaatId);
  const nextJamaat = index > -1 ? jamaats[index + 1] : null;

  const submit = useCallback(async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const missing = requiredFields.filter((f) => !form.values[f.key]);
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
        for (const k of f.hasActivities ? (activities[f.key] || []).map((a) => actKey(f.key, a.id)) : [f.key]) {
          if (form.values[k]) values[k] = form.values[k];
          if (f.hasComment && (form.comments[k] || "").trim()) comments[k] = form.comments[k];
        }
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
  }, [opts, form, month, jamaatId, jamaat, monthLabel, activities, requiredFields]);

  return (
    <div className="portal">
      <AppBar title="JC Portal" subtitle="Monthly Jamaat follow-up" nav={JC_NAV} page="/jc-portal/form" canLeave={okToLeave}
        theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />

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
                <MonthYearPicker months={opts.months} value={month} onChange={chooseMonth} />
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
                        if (f.hasActivities) {
                          return (
                            <ActivityQuestion key={f.key} f={f} list={activities[f.key] || []} form={form} monthLabel={monthLabel}
                              pick={actPick[f.key] || ""} onPick={(id) => setActPick((p) => ({ ...p, [f.key]: id }))}
                              setValue={setValue} setComment={setComment} commentMax={opts.commentMaxLength} />
                          );
                        }
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
                  <Link to="/jc-portal" className="btn btn-ghost">Back to dashboard</Link>
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

// A question with monthly activities: choose the activity, then its status (and comment).
// Every activity keeps its own answer; the chips show where each one stands.
function ActivityQuestion({ f, list, form, monthLabel, pick, onPick, setValue, setComment, commentMax }) {
  const act = list.find((a) => a.id === pick) || list[0];
  const k = act ? actKey(f.key, act.id) : "";
  const value = k ? form.values[k] || "" : "";
  const toneOf = (v) => (f.options.find((o) => o.value === v) || {}).tone || "na";
  const updated = list.filter((a) => form.values[actKey(f.key, a.id)]).length;

  return (
    <fieldset className="q q-acts" id={`q-${f.key}`}>
      <legend className="q-label">
        {f.label}
        {list.length > 0 && <span className="optional">{updated} of {list.length} activities updated</span>}
      </legend>
      {!list.length ? (
        <p className="act-none">No activities have been added for {monthLabel} yet.</p>
      ) : (
        <>
          <label className="field act-pick">
            <span className="field-label">Activity</span>
            <select value={act.id} onChange={(e) => onPick(e.target.value)}>
              {list.map((a) => {
                const v = form.values[actKey(f.key, a.id)];
                return <option key={a.id} value={a.id}>{a.name}{v ? ` — ${v}` : " — not updated"}</option>;
              })}
            </select>
          </label>
          <span className="field-label act-status-label">Status of “{act.name}”</span>
          <div className="seg-control" role="radiogroup" aria-label={`Status of ${act.name}`}>
            {f.options.map((o) => (
              <label key={o.value} className={`seg-opt tone-${o.tone}${value === o.value ? " is-on" : ""}`}>
                <input type="radio" name={k} value={o.value} checked={value === o.value} onChange={() => setValue(k, o.value)} />
                <span>{o.value}</span>
              </label>
            ))}
            {value && <button type="button" className="seg-clear" onClick={() => setValue(k, "")}>Clear</button>}
          </div>
          {f.hasComment && (
            <textarea className="input q-comment" rows={2} maxLength={commentMax}
              placeholder={`Comment on “${act.name}” (optional)`} aria-label={`Comment for ${f.label}: ${act.name}`}
              value={form.comments[k] || ""} onChange={(e) => setComment(k, e.target.value)} />
          )}
          {list.length > 1 && (
            <div className="act-chips" aria-label={`All ${f.label} activities`}>
              {list.map((a) => {
                const v = form.values[actKey(f.key, a.id)];
                return (
                  <button type="button" key={a.id} className={`act-chip${a.id === act.id ? " is-sel" : ""}`} onClick={() => onPick(a.id)}
                    aria-pressed={a.id === act.id} title={v ? `${a.name}: ${v}` : `${a.name}: not updated`}>
                    <span className={`dot tone-${v ? toneOf(v) : "empty"}`} />{a.name}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
