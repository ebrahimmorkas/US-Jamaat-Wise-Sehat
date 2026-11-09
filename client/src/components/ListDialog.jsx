import { useEffect, useRef, useState } from "react";
import { lower, plural } from "../lib/helpers";
import { CloseIcon } from "./Icons";
import StatusPill from "./StatusPill";

// Popup listing the Jamaats that have the chosen status.
// Columns: Jamiat=All -> Jamiat + Jamaat; one Jamiat -> Jamaat; one Jamaat -> none.
export default function ListDialog({ view, onClose }) {
  const ref = useRef(null);
  const [query, setQuery] = useState("");

  // Open/close only when a different list is chosen (not on every data refresh).
  const viewKey = view ? `${view.metric.key}|${view.status}` : "";
  useEffect(() => {
    const dlg = ref.current;
    if (viewKey && !dlg.open) dlg.showModal();
    if (!viewKey && dlg.open) dlg.close();
    setQuery("");
  }, [viewKey]);

  const v = view || { list: [] };
  const searchable = view && (v.showJamiat || v.showJamaat) && v.list.length > 8;
  const q = lower(query);
  const shown = q ? v.list.filter((r) => lower(r.name).includes(q) || lower(r.jamiat).includes(q)) : v.list;

  let body = null;
  if (view) {
    if (!v.list.length) {
      body = <div className="empty-state">No Jamaats with status “{v.status}”.</div>;
    } else if (!v.showJamiat && !v.showJamaat) {
      body = (
        <>
          <p>This Jamaat is marked <StatusPill status={v.status} tone={v.tone} /></p>
          {v.showRemarks && (
            <div className="remarks" style={{ margin: "12px 0 0" }}>
              <div className="eyebrow">Remarks / next action</div>{v.list[0].remarks}
            </div>
          )}
        </>
      );
    } else if (!shown.length) {
      body = <div className="empty-state">No match for “{query}”.</div>;
    } else {
      body = (
        <table>
          <thead>
            <tr>
              <th>#</th>
              {v.showJamiat && <th>Jamiat</th>}
              {v.showJamaat && <th>Jamaat</th>}
              {v.showRemarks && <th>Remarks</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.jamiat + "|" + r.name}>
                <td className="idx">{i + 1}</td>
                {v.showJamiat && <td>{r.jamiat}</td>}
                {v.showJamaat && <td>{r.name}</td>}
                {v.showRemarks && <td className="rmk">{r.remarks || "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
  }

  return (
    <dialog ref={ref} aria-labelledby="dlgTitle" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {view && (
        <>
          <div className="dlg-head">
            <div>
              <div className="eyebrow">{v.metric.group}</div>
              <h2 id="dlgTitle">{v.metric.label} <StatusPill status={v.status} tone={v.tone} /></h2>
              <p>{v.scopeText} · {plural(v.list.length, "Jamaat")}</p>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
          </div>
          {searchable && (
            <div className="dlg-tools">
              <input type="search" autoFocus placeholder="Search Jamiat or Jamaat…" aria-label="Search list"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          <div className="dlg-body">{body}</div>
        </>
      )}
    </dialog>
  );
}
