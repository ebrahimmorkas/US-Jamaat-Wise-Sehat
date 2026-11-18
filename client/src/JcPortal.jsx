import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthError, isServerStarting, portalEntry, portalOptions, portalSave } from "./lib/api";
import { BuildingIcon, CheckIcon, ChevronRight, CommentIcon, LockIcon } from "./components/Icons";
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
  doneDates: {}, // monthly activities: { "<question key>:<activity id>": "YYYY-MM-DD" } when the answer means done
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
// An answer whose meaning is "done" (shown in the green "good" tone): an activity then takes a "date done".
const isDone = (f, v) => !!v && (f.options.find((o) => o.value === v) || {}).tone === "good";
// "2026-11-12" -> "12 Nov"
const shortDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" }) : "";
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
  const [activities, setActivities] = useState({}); // this month's activities: { <question key>: [{ id, name }] }
  const [actPick, setActPick] = useState({});       // activity chosen in each activity question: { <question key>: id }
  const [baseline, setBaseline] = useState(""); // JSON of the last loaded/saved form (unsaved-changes check)
  const [savedAt, setSavedAt] = useState(null); // when this Jamaat's month was last saved
  const [entryLoading, setEntryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const [openComments, setOpenComments] = useState({}); // comment boxes opened with "Add a comment"

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
    setOpenComments({});
    portalEntry(jamaatId, month)
      .then(({ details, entry, activities: acts = {} }) => {
        if (!alive) return;
        const f = blankForm(details);
        if (entry) { f.values = { ...entry.values }; f.comments = { ...(entry.comments || {}) }; f.doneDates = { ...(entry.doneDates || {}) }; f.remarks = entry.remarks || ""; }
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

  // After saving, show the result (it is under the form; the Submit button may be at the top).
  useEffect(() => {
    if (!success) return;
    const el = document.getElementById("jcf-result");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [success]);

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
  // The Jamaat details are shown read-only and sent back as loaded; the server refuses (and logs) any change.
  const setComment = (key, v) => setForm((f) => ({ ...f, comments: { ...f.comments, [key]: v } }));
  const setDoneDate = (key, v) => setForm((f) => {
    const doneDates = { ...f.doneDates };
    if (v) doneDates[key] = v; else delete doneDates[key];
    return { ...f, doneDates };
  });

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

  // For the progress card: how many answers of each section are filled (an activity question counts each activity).
  const groupProgress = (g) => {
    let done = 0, all = 0;
    for (const f of g.fields) {
      const keys = f.hasActivities ? (activities[f.key] || []).map((a) => actKey(f.key, a.id)) : [f.key];
      all += keys.length;
      done += keys.filter((k) => form && form.values[k]).length;
    }
    return { done, all };
  };
  const commentOpen = (k) => openComments[k] || !!(form && (form.comments[k] || "").trim());
  const showComment = (k) => setOpenComments((o) => ({ ...o, [k]: true }));
  const scrollTo = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };

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
      const doneDates = {};
      for (const f of opts.fields) {
        for (const k of f.hasActivities ? (activities[f.key] || []).map((a) => actKey(f.key, a.id)) : [f.key]) {
          if (form.values[k]) values[k] = form.values[k];
          if (f.hasComment && (form.comments[k] || "").trim()) comments[k] = form.comments[k];
          if (f.hasActivities && form.doneDates[k] && isDone(f, form.values[k])) doneDates[k] = form.doneDates[k];
        }
      }
      const res = await portalSave({
        month, jamaatId, values, comments, doneDates, remarks: form.remarks,
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

  const statusLine = savedAt
    ? <>Saved on <b>{fmtTime(savedAt)}</b></>
    : <>Not submitted yet</>;
  const submitText = saving ? "Saving…" : savedAt ? "Save changes" : "Submit form";

  return (
    <div className="portal">
      <AppBar title="JC Portal" subtitle="Monthly Jamaat follow-up" nav={JC_NAV} page="/jc-portal/form" canLeave={okToLeave}
        theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />

      <main className="container jcf">
        {!opts ? (
          <div className="panel portal-empty">{loadMsg}</div>
        ) : (
          <div className="jcf-layout">
            {/* ---- left: which Jamaat + progress ---- */}
            <aside className="jcf-side">
              <section className="panel jcf-card" aria-label="Choose the Jamaat">
                <h2 className="jcf-card-title"><span className="step-no">1</span> Choose the Jamaat</h2>
                {!opts.jamiats.length && <p className="jcf-hint">No Jamaats are assigned to you yet. Please contact the Super Admin.</p>}
                <div className="jcf-pick">
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
                {jamaat && form && !entryLoading && (
                  <div className="jcf-details" title="These details can be changed only by the Super Admin.">
                    <div><span>Mauze Type <LockIcon /></span><b>{form.details.mauzeType || "Not set"}</b></div>
                    <div><span>House Count <LockIcon /></span><b>{form.details.houseCount || "Not set"}</b></div>
                  </div>
                )}
              </section>

              {jamaat && form && !entryLoading && (
                <section className="panel jcf-card jcf-progress" aria-label="Progress">
                  <h2 className="jcf-card-title"><span className="step-no">2</span> Fill the answers</h2>
                  <div className={`jcf-state${savedAt ? " is-saved" : ""}`}>{statusLine}{dirty && <span className="unsaved"> · unsaved changes</span>}</div>
                  <div className="jcf-meter">
                    <div className="jcf-meter-top"><span>Required answers</span><b>{answered} / {total}</b></div>
                    <div className="progress"><span style={{ width: `${total ? (answered / total) * 100 : 100}%` }} /></div>
                  </div>
                  <ul className="jcf-steps">
                    {groups.map((g, i) => {
                      const p = groupProgress(g);
                      const full = p.all > 0 && p.done === p.all;
                      return (
                        <li key={g.name || i}>
                          <button type="button" onClick={() => scrollTo(`sec-${i}`)} className={full ? "is-full" : ""}>
                            <span className="jcf-step-mark" aria-hidden="true">{full ? <CheckIcon /> : i + 1}</span>
                            <span className="jcf-step-name">{g.name || "Questions"}</span>
                            <span className="jcf-step-count">{p.done}/{p.all}</span>
                          </button>
                        </li>
                      );
                    })}
                    <li>
                      <button type="button" onClick={() => scrollTo("sec-remarks")} className={form.remarks.trim() ? "is-full" : ""}>
                        <span className="jcf-step-mark" aria-hidden="true">{form.remarks.trim() ? <CheckIcon /> : groups.length + 1}</span>
                        <span className="jcf-step-name">Remarks <span className="optional">(optional)</span></span>
                      </button>
                    </li>
                  </ul>
                  <button type="submit" form="jc-form" className="btn btn-primary jcf-side-submit" disabled={saving}>{submitText}</button>
                </section>
              )}
            </aside>

            {/* ---- right: the questions ---- */}
            <div className="jcf-main">
              {!form && <Notice type="error" text={error} onClose={() => setError("")} />}

              {!jamaat && (
                <div className="panel jcf-empty">
                  <div className="jcf-empty-icon" aria-hidden="true"><BuildingIcon /></div>
                  <h2>Choose a Jamaat to start</h2>
                  <p>Select the month, Jamiat and Jamaat on the left. The questions for that Jamaat will appear here.</p>
                </div>
              )}

              {jamaat && entryLoading && <div className="panel portal-empty">Loading {jamaat.name}…</div>}

              {jamaat && form && !entryLoading && (
                <form id="jc-form" onSubmit={submit} noValidate>
                  <header className="jcf-head">
                    <div>
                      <div className="eyebrow">{jamiat ? jamiat.name : ""} · {monthLabel}</div>
                      <h1>{jamaat.name}</h1>
                    </div>
                    <p className="jcf-legend">Tap an answer to choose it. <span className="req-star">*</span> = required</p>
                  </header>

                  {groups.map((g, gi) => {
                    const p = groupProgress(g);
                    return (
                      <section className="panel jcf-section" key={g.name || gi} id={`sec-${gi}`}>
                        <header className="jcf-section-head">
                          <h2>{g.name || "Questions"}</h2>
                          <span className={`jcf-count${p.all && p.done === p.all ? " is-full" : ""}`}>{p.done} of {p.all} answered</span>
                        </header>
                        {g.fields.map((f) => {
                          if (f.hasActivities) {
                            return (
                              <ActivityQuestion key={f.key} f={f} list={activities[f.key] || []} form={form} monthLabel={monthLabel}
                                pick={actPick[f.key] || ""} onPick={(id) => setActPick((p2) => ({ ...p2, [f.key]: id }))}
                                setValue={setValue} setComment={setComment} setDoneDate={setDoneDate} commentMax={opts.commentMaxLength}
                                commentOpen={commentOpen} showComment={showComment} />
                            );
                          }
                          const value = form.values[f.key] || "";
                          const missing = showMissing && !value;
                          return (
                            <fieldset className={`jcq${missing ? " is-missing" : ""}${value ? " is-answered" : ""}`} key={f.key} id={`q-${f.key}`}>
                              <legend className="jcq-label">
                                <span className="jcq-mark" aria-hidden="true">{value ? <CheckIcon /> : null}</span>
                                <span>{f.label}{f.required && <span className="req-star" title="Required"> *</span>}</span>
                                {!f.required && <span className="optional">(optional)</span>}
                                {missing && <span className="q-req">Please answer</span>}
                              </legend>
                              <div className="jcq-body">
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
                                {f.hasComment && (commentOpen(f.key) ? (
                                  <textarea className="input q-comment" rows={2} maxLength={opts.commentMaxLength} autoFocus={!!openComments[f.key] && !form.comments[f.key]}
                                    placeholder="Comment (optional)" aria-label={`Comment for ${f.label}`}
                                    value={form.comments[f.key] || ""} onChange={(e) => setComment(f.key, e.target.value)} />
                                ) : (
                                  <button type="button" className="add-comment" onClick={() => showComment(f.key)}>
                                    <CommentIcon size={13} /> Add a comment
                                  </button>
                                ))}
                              </div>
                            </fieldset>
                          );
                        })}
                      </section>
                    );
                  })}

                  <section className="panel jcf-section" id="sec-remarks">
                    <header className="jcf-section-head">
                      <h2>{opts.remarksLabel} <span className="optional">(optional)</span></h2>
                      <span className="jcf-count">{form.remarks.length}/{opts.remarksMaxLength}</span>
                    </header>
                    <textarea className="input jcf-remarks" rows={3} maxLength={opts.remarksMaxLength}
                      placeholder="Add a short note only when needed" aria-label={opts.remarksLabel}
                      value={form.remarks} onChange={(e) => setForm((x) => ({ ...x, remarks: e.target.value }))} />
                  </section>

                  <div id="jcf-result" className="jcf-result">
                  <Notice type="error" text={error} onClose={() => setError("")} />
                  <Notice type="ok" text={success} onClose={() => setSuccess("")}>
                    <Link to="/jc-portal" className="btn btn-ghost">Back to dashboard</Link>
                    {nextJamaat && (
                      <button type="button" className="btn btn-ghost" onClick={() => { setJamaatId(nextJamaat.id); setSuccess(""); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        Next: {nextJamaat.name} <ChevronRight size={14} />
                      </button>
                    )}
                  </Notice>
                  </div>

                  {/* phones / tablets: the progress card is above, so the Submit button stays at the bottom of the screen */}
                  <div className="save-bar">
                    <div className="save-progress">
                      <b>{answered}</b> of {total} required answered
                      {dirty && <span className="unsaved">· unsaved changes</span>}
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={saving}>{submitText}</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// A question with monthly activities: choose the activity, then its status (and comment).
// Every activity keeps its own answer; the list shows where each one stands.
function ActivityQuestion({ f, list, form, monthLabel, pick, onPick, setValue, setComment, setDoneDate, commentMax, commentOpen, showComment }) {
  const act = list.find((a) => a.id === pick) || list[0];
  const k = act ? actKey(f.key, act.id) : "";
  const value = k ? form.values[k] || "" : "";
  const toneOf = (v) => (f.options.find((o) => o.value === v) || {}).tone || "na";
  const updated = list.filter((a) => form.values[actKey(f.key, a.id)]).length;

  return (
    <fieldset className={`jcq jcq-acts${list.length && updated === list.length ? " is-answered" : ""}`} id={`q-${f.key}`}>
      <legend className="jcq-label">
        <span className="jcq-mark" aria-hidden="true">{list.length && updated === list.length ? <CheckIcon /> : null}</span>
        <span>{f.label}</span>
        {list.length > 0 && <span className="optional">{updated} of {list.length} activities updated</span>}
      </legend>
      <div className="jcq-body">
        {!list.length ? (
          <p className="act-none">No activities have been added for {monthLabel} yet.</p>
        ) : (
          <div className="act-box">
            <div className="act-step">
              <span className="act-step-no">a</span>
              <label className="field act-pick">
                <span className="field-label">Choose the activity</span>
                <select value={act.id} onChange={(e) => onPick(e.target.value)}>
                  {list.map((a) => {
                    const v = form.values[actKey(f.key, a.id)];
                    const d = isDone(f, v) && shortDate(form.doneDates[actKey(f.key, a.id)]);
                    return <option key={a.id} value={a.id}>{a.name}{v ? ` — ${v}${d ? ` (${d})` : ""}` : " — not updated"}</option>;
                  })}
                </select>
              </label>
            </div>
            <div className="act-step">
              <span className="act-step-no">b</span>
              <div className="act-status">
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
                {isDone(f, value) && (
                  <label className="act-date">
                    <span className="field-label">Date done <span className="muted">(optional)</span></span>
                    <span className="act-date-row">
                      <input className="input date-input" type="date" min="2020-01-01" max={today()} value={form.doneDates[k] || ""}
                        onChange={(e) => setDoneDate(k, e.target.value)} aria-label={`Date ${act.name} was done`} />
                      {form.doneDates[k] && <button type="button" className="seg-clear" onClick={() => setDoneDate(k, "")}>Clear</button>}
                    </span>
                  </label>
                )}
                {f.hasComment && (commentOpen(k) ? (
                  <textarea className="input q-comment" rows={2} maxLength={commentMax}
                    placeholder={`Comment on “${act.name}” (optional)`} aria-label={`Comment for ${f.label}: ${act.name}`}
                    value={form.comments[k] || ""} onChange={(e) => setComment(k, e.target.value)} />
                ) : (
                  <button type="button" className="add-comment" onClick={() => showComment(k)}>
                    <CommentIcon size={13} /> Add a comment on “{act.name}”
                  </button>
                ))}
              </div>
            </div>
            {list.length > 1 && (
              <div className="act-chips" aria-label={`All ${f.label} activities`}>
                {list.map((a) => {
                  const v = form.values[actKey(f.key, a.id)];
                  const d = isDone(f, v) && shortDate(form.doneDates[actKey(f.key, a.id)]);
                  return (
                    <button type="button" key={a.id} className={`act-chip${a.id === act.id ? " is-sel" : ""}`} onClick={() => onPick(a.id)}
                      aria-pressed={a.id === act.id} title={v ? `${a.name}: ${v}` : `${a.name}: not updated`}>
                      <span className={`dot tone-${v ? toneOf(v) : "empty"}`} />{a.name}
                      <small>{v ? `${v}${d ? ` · ${d}` : ""}` : "not updated"}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}
