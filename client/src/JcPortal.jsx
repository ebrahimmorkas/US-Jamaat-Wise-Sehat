import { useCallback, useEffect, useMemo, useState } from "react";
import { isServerStarting, portalEntry, portalOptions, portalSave } from "./lib/api";
import { ChevronRight, MoonIcon, SunIcon } from "./components/Icons";
import Notice from "./components/Notice";

const LAST_JAMIAT = "jc-portal:jamiat";
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

const blankForm = (details) => ({
  values: {},
  remarks: "",
  details: {
    mauzeType: details.mauzeType || "",
    houseCount: details.houseCount == null ? "" : String(details.houseCount),
    children: details.children == null ? "" : String(details.children),
  },
});

const fmtTime = (d) =>
  new Date(d).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Public form where a JC fills one Jamaat's monthly follow-up.
export default function JcPortal({ theme, onToggleTheme }) {
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
        if (entry) { f.values = { ...entry.values }; f.remarks = entry.remarks || ""; }
        setForm(f);
        setBaseline(JSON.stringify(f));
        setSavedAt(entry ? entry.updatedAt : null);
      })
      .catch((err) => { if (alive) { setForm(null); setError(err.message); } })
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
  const setDetail = (key, v) => setForm((f) => ({ ...f, details: { ...f.details, [key]: v } }));

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
      for (const f of opts.fields) if (form.values[f.key]) values[f.key] = form.values[f.key];
      const res = await portalSave({
        month, jamaatId, values, remarks: form.remarks,
        details: form.details,
      });
      const f = { ...form, details: blankForm(res.details).details };
      setForm(f);
      setBaseline(JSON.stringify(f));
      setSavedAt(res.updatedAt);
      setShowMissing(false);
      setSuccess(`${res.firstSubmission ? "Saved" : "Updated"} ${jamaat.name} for ${monthLabel}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [opts, form, month, jamaatId, jamaat, monthLabel]);

  const dark = theme === "dark";

  return (
    <div className="portal">
      <header className="appbar">
        <div className="container appbar-inner portal-bar">
          <div className="brand">
            <img className="brand-logo" src="/logo.png" alt="Umoor Sehhat logo" />
            <span className="brand-divider" aria-hidden="true" />
            <div>
              <div className="brand-name">JC Portal</div>
              <div className="brand-sub">Monthly Jamaat follow-up</div>
            </div>
          </div>
          <button type="button" className={`icon-toggle${dark ? " is-dark" : ""}`} onClick={onToggleTheme}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
            <span className="sun"><SunIcon /></span>
            <span className="moon"><MoonIcon /></span>
          </button>
        </div>
      </header>

      <main className="container portal-main">
        {!opts ? (
          <div className="panel portal-empty">{loadMsg}</div>
        ) : (
          <>
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
                      <span className="field-label">Mauze Type</span>
                      <select value={form.details.mauzeType} onChange={(e) => setDetail("mauzeType", e.target.value)}>
                        <option value="">Not set</option>
                        {opts.mauzeTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">House Count</span>
                      <input className="input" type="number" inputMode="numeric" min="0" step="1"
                        value={form.details.houseCount} onChange={(e) => setDetail("houseCount", e.target.value)} />
                    </label>
                    <label className="field">
                      <span className="field-label">Children</span>
                      <input className="input" type="number" inputMode="numeric" min="0" step="1"
                        value={form.details.children} onChange={(e) => setDetail("children", e.target.value)} />
                    </label>
                  </div>
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
