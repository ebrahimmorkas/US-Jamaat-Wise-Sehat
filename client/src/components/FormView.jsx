import { useEffect, useMemo, useRef } from "react";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from "libphonenumber-js/min";
import MultiSelect from "./MultiSelect";
import { CloseIcon, UploadIcon } from "./Icons";

// A form as the person filling it sees it (also the Super Admin's preview).
//   form: { title, description, topImage, fields: [{ key, type, label, help, placeholder, required, options, min, max, maxFiles, accept, maxMb }] }
//   values: { <key>: value }   onChange(key, value)   problems: { <key>: message }
//   onUpload(field, File) -> Promise   (uploads: [{ id, token?, name, size, type, preview?, progress?, error? }])
//   preview: nothing can be sent / uploaded   locked: read only (e.g. sending)
export const fmtWhen = (d) => (d ? new Date(d).toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
export const myZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
export const fmtSize = (b) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(1)} GB` : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isLayout = (t) => t === "heading" || t === "paragraph";

// ---------- Phone numbers: a country + the number, checked with that country's rules ----------
const regionOfBrowser = () => {
  try { const r = new Intl.Locale(navigator.language || "en-IN").maximize().region; return r && getCountries().includes(r) ? r : "IN"; } catch { return "IN"; }
};
/** Saved answer ("+919876543210") or what is being typed ({ country, number }) -> { country, number }. */
export function phoneParts(v) {
  if (v && typeof v === "object") return v;
  const ph = typeof v === "string" && v ? parsePhoneNumberFromString(v) : null;
  return ph ? { country: ph.country || regionOfBrowser(), number: ph.formatNational() } : { country: regionOfBrowser(), number: "" };
}
/** What is sent: "+<code><number>" (the server checks it again). Empty when no number was typed. */
export function phoneValue(v) {
  const { country, number } = phoneParts(v);
  if (!String(number || "").trim()) return "";
  const ph = parsePhoneNumberFromString(number, country);
  return ph ? ph.number : `+${getCountryCallingCode(country)}${String(number).replace(/\D/g, "")}`;
}
export const phoneOk = (v) => { const s = phoneValue(v); const ph = s && parsePhoneNumberFromString(s); return !!(ph && ph.isValid()); };

// part: "all" (default), "head" = top image + name + description only, "questions" = the questions only
// (the fill page puts Jamiat, Jamaat and email between the two).
export default function FormView({ form, values, onChange, problems = {}, onUpload, onRemoveFile, preview, locked, part = "all" }) {
  let n = 0;
  return (
    <div className="fv">
      {part !== "questions" && form.topImage && <img className="fv-top" src={form.topImage} alt="" />}
      {part !== "questions" && (
        <div className="fv-head">
          <h1>{form.title || "Untitled form"}</h1>
          {form.description && <p className="fv-desc">{form.description}</p>}
        </div>
      )}
      {part !== "head" && form.fields.some((f) => f.required) && <p className="fv-req-note"><span className="fv-star">*</span> Required</p>}
      {part !== "head" && form.fields.map((f) => {
        if (isLayout(f.type)) {
          return f.type === "heading"
            ? <div key={f.key} className="fv-section"><h2>{f.label}</h2>{f.help && <p>{f.help}</p>}</div>
            : <div key={f.key} className="fv-info">{f.label && <b>{f.label}</b>}{f.help && <p>{f.help}</p>}</div>;
        }
        n += 1;
        return (
          <Question key={f.key} n={n} f={f} value={values[f.key]} problem={problems[f.key]} locked={locked}
            set={(v) => onChange(f.key, v)} preview={preview} onUpload={onUpload} onRemoveFile={onRemoveFile} />
        );
      })}
    </div>
  );
}

function Question({ n, f, value, problem, set, preview, locked, onUpload, onRemoveFile }) {
  const id = `q-${f.key}`;
  const hint = hintOf(f);
  return (
    <fieldset className={`fv-q${problem ? " has-problem" : ""}`} id={id} disabled={locked}>
      <legend className="fv-label"><span className="fv-n">{n}.</span> {f.label}{f.required && <span className="fv-star" aria-label="required"> *</span>}</legend>
      {f.help && <p className="fv-help">{f.help}</p>}
      <Input f={f} value={value} set={set} id={id} preview={preview} onUpload={onUpload} onRemoveFile={onRemoveFile} />
      {hint && <p className="fv-hint">{hint}</p>}
      {problem && <p className="fv-problem" role="alert">{problem}</p>}
    </fieldset>
  );
}

function hintOf(f) {
  const t = f.type;
  if (t === "number") return f.min != null && f.max != null ? `Enter a number from ${f.min} to ${f.max}` : f.min != null ? `Enter a number of ${f.min} or more` : f.max != null ? `Enter a number up to ${f.max}` : "";
  if (t === "checkbox" || t === "multi_select") return f.min != null && f.max != null ? `Choose ${f.min} to ${f.max}` : f.min != null ? `Choose at least ${f.min}` : f.max != null ? `Choose up to ${f.max}` : "";
  if (t === "short_text" || t === "long_text") return f.min != null && f.max != null ? `Write ${f.min} to ${f.max} characters` : f.min != null ? `Write at least ${f.min} characters` : f.max != null ? `Up to ${f.max} characters` : "";
  if (t === "image" || t === "video" || t === "file") return `${(f.accept || []).map((e) => e.toUpperCase()).join(", ")} · up to ${f.maxMb} MB${(f.maxFiles || 1) > 1 ? ` each · up to ${f.maxFiles} files` : ""}`;
  return "";
}

function Input({ f, value, set, id, preview, onUpload, onRemoveFile }) {
  const v = value == null ? "" : value;
  const text = (type, extra = {}) => (
    <input className="input fv-input" type={type} value={v} placeholder={f.placeholder || ""} onChange={(e) => set(e.target.value)} aria-labelledby={id} {...extra} />
  );
  switch (f.type) {
    case "short_text": return text("text", { maxLength: f.max || 500 });
    case "email": return text("email", { inputMode: "email", autoComplete: "email" });
    case "phone": return <PhoneField value={value} set={set} placeholder={f.placeholder} />;
    case "number": return text("number", { inputMode: "decimal", min: f.min ?? undefined, max: f.max ?? undefined, step: "any" });
    case "date": return text("date");
    case "time": return text("time");
    case "datetime": return text("datetime-local");
    case "long_text": return <AutoArea value={v} max={f.max || 5000} placeholder={f.placeholder} onChange={set} />;
    case "select":
      return (
        <select className="fv-select" value={v} onChange={(e) => set(e.target.value)}>
          <option value="">Choose…</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "multi_select":
      return <div className="fv-multi"><MultiSelect label="" noun="choice" options={f.options.map((o) => ({ value: o, label: o }))} selected={Array.isArray(value) ? value : []} onChange={set} /></div>;
    case "radio":
      return (
        <div className="fv-choices">
          {f.options.map((o) => (
            <label key={o} className={`fv-choice${v === o ? " is-on" : ""}`}>
              <input type="radio" name={id} checked={v === o} onChange={() => set(o)} /> <span>{o}</span>
            </label>
          ))}
          {v && !f.required && <button type="button" className="link-btn fv-clear" onClick={() => set("")}>Clear choice</button>}
        </div>
      );
    case "checkbox": {
      const list = Array.isArray(value) ? value : [];
      return (
        <div className="fv-choices">
          {f.options.map((o) => (
            <label key={o} className={`fv-choice${list.includes(o) ? " is-on" : ""}`}>
              <input type="checkbox" checked={list.includes(o)} onChange={(e) => set(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> <span>{o}</span>
            </label>
          ))}
        </div>
      );
    }
    case "yes_no":
      return (
        <div className="fv-yesno">
          {["Yes", "No"].map((o) => (
            <button key={o} type="button" className={`fv-pick${v === o ? " is-on" : ""}`} aria-pressed={v === o} onClick={() => set(v === o && !f.required ? "" : o)}>{o}</button>
          ))}
        </div>
      );
    case "rating": {
      const stars = f.max || 5;
      const cur = Number(v) || 0;
      return (
        <div className="fv-stars" role="radiogroup" aria-labelledby={id}>
          {Array.from({ length: stars }, (_, i) => i + 1).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={cur === s} aria-label={`${s} star${s > 1 ? "s" : ""}`}
              className={`fv-star-btn${s <= cur ? " is-on" : ""}`} onClick={() => set(cur === s ? "" : s)}>★</button>
          ))}
          {cur > 0 && <span className="fv-star-text">{cur} of {stars}</span>}
        </div>
      );
    }
    case "image": case "video": case "file":
      return <Files f={f} list={Array.isArray(value) ? value : []} preview={preview} onUpload={onUpload} onRemove={(item) => onRemoveFile(f, item)} />;
    default: return null;
  }
}

const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
function PhoneField({ value, set, placeholder }) {
  const { country, number } = phoneParts(value);
  const countries = useMemo(() => {
    let names = null;
    try { names = new Intl.DisplayNames([navigator.language || "en"], { type: "region" }); } catch { /* old browser */ }
    return getCountries().map((c) => ({ c, name: (names && names.of(c)) || c, code: getCountryCallingCode(c) })).sort((a, b) => a.name.localeCompare(b.name));
  }, []);
  const typed = String(number || "").replace(/\D/g, "").length >= 4;
  const good = typed && phoneOk({ country, number });
  return (
    <div className="fv-phone">
      <div className="fv-phone-row">
        <select className="fv-cc" value={country} aria-label="Country" onChange={(e) => set({ country: e.target.value, number })}>
          {countries.map((x) => <option key={x.c} value={x.c}>{flag(x.c)} {x.name} (+{x.code})</option>)}
        </select>
        <input className="input fv-input" type="tel" inputMode="tel" autoComplete="tel-national" value={number} placeholder={placeholder || "Phone number"}
          onChange={(e) => set({ country, number: e.target.value.replace(/[^\d\s()-]/g, "").slice(0, 20) })} />
      </div>
      {typed && <span className={`fv-phone-check ${good ? "good" : "bad"}`}>{good ? "✓ Valid number" : "Not a valid number for this country yet"}</span>}
    </div>
  );
}

function AutoArea({ value, max, placeholder, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 480)}px`;
  }, [value]);
  return (
    <div className="fv-area">
      <textarea ref={ref} className="input fv-input" rows={3} maxLength={max} value={value} placeholder={placeholder || ""} onChange={(e) => onChange(e.target.value)} />
      <span className="fv-count">{String(value).length} / {max}</span>
    </div>
  );
}

function Files({ f, list, preview, onUpload, onRemove }) {
  const input = useRef(null);
  const most = f.maxFiles || 1;
  const accept = (f.accept || []).map((e) => `.${e}`).join(",");
  const full = list.length >= most;
  return (
    <div className="fv-files">
      {list.map((it) => (
        <div key={it.id || it.tmp} className={`fv-file${it.error ? " is-bad" : ""}`}>
          {it.preview && f.type === "image" && <img src={it.preview} alt="" />}
          {it.preview && f.type === "video" && <video src={it.preview} muted playsInline />}
          <div className="fv-file-text">
            <span className="fv-file-name">{it.name || "File"}</span>
            <span className="fv-file-sub">
              {it.error ? it.error : it.progress != null && it.progress < 1 ? `Uploading… ${Math.round(it.progress * 100)}%` : it.size ? fmtSize(it.size) : ""}
            </span>
            {it.progress != null && it.progress < 1 && !it.error && <span className="fv-bar"><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></span>}
          </div>
          <button type="button" className="icon-btn" onClick={() => onRemove(it)} aria-label={`Remove ${it.name || "file"}`} title="Remove"><CloseIcon /></button>
        </div>
      ))}
      {!full && (
        <>
          <button type="button" className="btn btn-ghost fv-upload" disabled={preview} onClick={() => input.current && input.current.click()}
            title={preview ? "Uploads work on the real form, not in the preview" : ""}>
            <UploadIcon /> <span>{list.length ? "Add another" : f.type === "image" ? "Choose image" : f.type === "video" ? "Choose video" : "Choose file"}</span>
          </button>
          <input ref={input} type="file" hidden accept={accept} multiple={most - list.length > 1}
            onChange={(e) => { const files = [...e.target.files].slice(0, most - list.length); e.target.value = ""; files.forEach((file) => onUpload(f, file)); }} />
        </>
      )}
    </div>
  );
}
