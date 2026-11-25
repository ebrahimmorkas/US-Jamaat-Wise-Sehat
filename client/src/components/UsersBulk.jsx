import { useRef, useState } from "react";
import Notice from "./Notice";
import { DownloadIcon, UploadIcon } from "./Icons";
import { usersBulkAdd, usersBulkPreview, usersBulkSample } from "../lib/api";
import { plural } from "../lib/helpers";

// Users page: add many users from an Excel file. Download the sample, fill it, choose it:
// every row is checked first (nothing saved), then "Add N users" adds the rows that are OK.
export default function UsersBulk({ onAdded, onAuthFail }) {
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null); // { rows, ok, errors }
  const [done, setDone] = useState(null); // { rows, added, errors }
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);

  const fail = (e) => { if (onAuthFail && onAuthFail(e)) return; setErr(e.message || "Something went wrong. Try again."); };
  const reset = () => { setFile(null); setPlan(null); setDone(null); setErr(""); setOnlyErrors(false); if (fileRef.current) fileRef.current.value = ""; };

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    reset();
    if (!/\.xlsx$/i.test(f.name)) { setErr("Choose an Excel file (.xlsx). Start from the sample file."); return; }
    setFile(f);
    setBusy("preview");
    try { setPlan(await usersBulkPreview(f)); } catch (x) { setFile(null); fail(x); } finally { setBusy(""); }
  };
  const add = async () => {
    setBusy("add"); setErr("");
    try {
      const r = await usersBulkAdd(file);
      setDone(r); setPlan(null);
      if (r.added) onAdded(r.added);
    } catch (x) { fail(x); } finally { setBusy(""); }
  };
  const sample = async () => {
    setBusy("sample"); setErr("");
    try { await usersBulkSample(); } catch (x) { fail(x); } finally { setBusy(""); }
  };

  const view = done || plan;
  const rows = view ? view.rows.filter((r) => !onlyErrors || !r.ok) : [];
  return (
    <div className="panel bulk-users">
      <div className="panel-head">
        <div>
          <h2>Add many users from Excel</h2>
          <p>Download the sample, fill one row per person (Gmail, Role, and for JCs / Jamaat Coordinators their Jamiats / Jamaats), then choose the file. Every row is checked before anything is added.</p>
        </div>
        {!open && <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}><UploadIcon /><span>Bulk upload</span></button>}
      </div>
      {open && (
        <>
          <div className="bulk-actions">
            <button type="button" className="btn btn-ghost" onClick={sample} disabled={!!busy}><DownloadIcon /><span>{busy === "sample" ? "Downloading…" : "Download sample file"}</span></button>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={pick} />
            <button type="button" className="btn btn-primary" onClick={() => fileRef.current.click()} disabled={!!busy}><UploadIcon /><span>{file ? "Choose another file" : "Choose Excel file"}</span></button>
            <button type="button" className="btn btn-ghost" onClick={() => { reset(); setOpen(false); }} disabled={busy === "add"}>Close</button>
          </div>
          {err && <Notice type="error" text={err} onClose={() => setErr("")} />}
          {busy === "preview" && <p className="muted">Checking {file && file.name}…</p>}

          {view && (
            <div className="bulk-result">
              {done ? (
                <div className={`bulk-summary${done.added ? " is-good" : " is-bad"}`}>
                  <p><b>{plural(done.added, "user")} added</b>{done.errors ? ` · ${plural(done.errors, "row")} not added (reasons below)` : ""}. They can sign in with Google now.</p>
                </div>
              ) : (
                <div className={`bulk-summary${plan.ok ? "" : " is-bad"}`}>
                  <p><b>{file.name}</b>: {plural(plan.rows.length, "row")} · <b>{plan.ok} ready to add</b>{plan.errors ? ` · ${plural(plan.errors, "row")} with a problem (won't be added)` : ""}.</p>
                  {plan.errors > 0 && <p className="muted">Fix those rows in the file and choose it again, or add the ready ones now and the rest later.</p>}
                </div>
              )}
              {view.rows.some((r) => !r.ok) && view.rows.some((r) => r.ok) && (
                <label className="check bulk-only"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Show only the rows with a problem</label>
              )}
              <div className="data-scroll bulk-scroll">
                <table className="data-table compact">
                  <thead><tr><th>Row</th><th>Gmail</th><th>Role</th><th>Assigned</th><th>Result</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} className={r.ok ? "" : "is-bad"}>
                        <td className="muted">{r.row}</td>
                        <td>{r.email || <span className="muted">—</span>}{r.tester && <span className="pill warn tester-pill">Tester</span>}</td>
                        <td>{r.roleLabel || <span className="muted">—</span>}</td>
                        <td>{r.access || <span className="muted">—</span>}</td>
                        <td>
                          {r.ok ? <span className="pill good">{r.added ? "Added" : "Ready"}</span> : <span className="bulk-err">{r.error}</span>}
                          {r.ok && r.note && <small className="bulk-note">{r.note}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {plan && (
                <div className="bulk-actions">
                  <button type="button" className="btn btn-primary" onClick={add} disabled={!plan.ok || !!busy}>
                    {busy === "add" ? "Adding…" : plan.ok ? `Add ${plural(plan.ok, "user")}` : "Nothing to add"}</button>
                  <button type="button" className="btn btn-ghost" onClick={reset} disabled={!!busy}>Cancel</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
