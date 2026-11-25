import { useEffect, useState } from "react";
import { fmtWhen } from "./FormView";
import { FormIcon, DownloadIcon } from "./Icons";
import { jcFormLinks, jcLinksExcel } from "../lib/api";
import { lower } from "../lib/helpers";

// JC dashboard: open forms, with a link for each Jamaat Coordinator of the JC's Jamaats (copy and share).
const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }
};

export default function FormLinksPanel() {
  const [forms, setForms] = useState(null);
  const [open, setOpen] = useState("");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    jcFormLinks().then((r) => alive && setForms(r.forms)).catch(() => alive && setForms([]));
    return () => { alive = false; };
  }, []);
  if (!forms || !forms.length) return null; // nothing to share

  const download = (f) => {
    setBusy(f.id); setErr("");
    jcLinksExcel(f.id).catch((e) => setErr(e.message || "Couldn't download the Excel file.")).finally(() => setBusy(""));
  };
  const doCopy = (key, link) => copyText(link).then(() => { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1800); });
  return (
    <div className="panel form-links">
      <div className="panel-head"><div><h2><FormIcon /> Form links for your Jamaat Coordinators</h2>
        <p>Copy a link and send it to the Coordinator, or download all of them as an Excel file (one sheet per Jamiat). Personal links have their Gmail inside, so send each one only to that person.</p></div></div>
      {err && <div className="alert" role="alert">{err}</div>}
      {forms.map((f) => {
        const q = lower(query);
        const people = f.coordinators.filter((p) => !q || lower(p.jamaat).includes(q) || lower(p.jamiat).includes(q) || lower(p.email).includes(q) || lower(p.name).includes(q));
        const isOpen = open === f.id || forms.length === 1;
        return (
          <div key={f.id} className="fl-form">
            <button type="button" className="fl-title" onClick={() => setOpen(isOpen ? "" : f.id)} aria-expanded={isOpen}>
              <b>{f.title}</b>
              <span className="muted">{f.state === "not_started" ? `opens ${fmtWhen(f.startAt)}` : `closes ${fmtWhen(f.endAt)}`} · {f.coordinators.length} Coordinator{f.coordinators.length === 1 ? "" : "s"}</span>
            </button>
            {f.access === "personal_link" && (
              <div className="fl-dl">
                <span className="muted">Personal links of your Jamaats' Coordinators: download them and send each link to its Coordinator.</span>
                <button type="button" className="btn btn-ghost" onClick={() => download(f)} disabled={busy === f.id}>
                  <DownloadIcon /> <span>{busy === f.id ? "Downloading…" : "Download Excel"}</span></button>
              </div>
            )}
            {isOpen && (
              f.access !== "personal_link" ? (
                <div className="fl-row"><span>Same link for everyone{f.access === "signed_in" ? " (they sign in with their Gmail)" : ""}</span>
                  <button type="button" className="mini-btn primary" onClick={() => doCopy(f.id, f.link)}>{copied === f.id ? "Copied ✓" : "Copy link"}</button></div>
              ) : !f.coordinators.length ? (
                <p className="muted fl-empty">None of your Jamaats has a Jamaat Coordinator yet (the Super Admin adds them).</p>
              ) : (
                <>
                  {f.coordinators.length > 8 && <input className="input fl-search" type="search" placeholder="Search Jamaat or Gmail…" value={query} onChange={(e) => setQuery(e.target.value)} />}
                  <ul className="fl-list">
                    {people.map((p) => {
                      const key = `${f.id}:${p.email}`;
                      return (
                        <li key={key} className="fl-row">
                          <span><b>{p.jamaat}</b> <span className="muted">· {p.jamiat}</span><br /><small>{p.name ? `${p.name} · ` : ""}{p.email}</small></span>
                          <button type="button" className="mini-btn primary" onClick={() => doCopy(key, p.link)}>{copied === key ? "Copied ✓" : "Copy link"}</button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
