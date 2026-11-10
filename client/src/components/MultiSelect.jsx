import { useEffect, useMemo, useRef, useState } from "react";
import { lower } from "../lib/helpers";

// Searchable multi-select dropdown with an "All" option.
//   options: [{ value, label, group? }]   (items with the same group are listed under a heading)
//   selected: [values]   onChange(values)   noun: "Jamiat" | "Jamaat"
export default function MultiSelect({ label, options, selected, onChange, noun, disabled, emptyText }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef(null);
  const sel = useMemo(() => new Set(selected), [selected]);
  const nouns = noun + "s";

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const q = lower(query);
  const shown = q ? options.filter((o) => lower(o.label).includes(q) || lower(o.group).includes(q)) : options;
  const groups = [];
  for (const o of shown) {
    const g = o.group || "";
    let entry = groups.find((x) => x.name === g);
    if (!entry) groups.push((entry = { name: g, items: [] }));
    entry.items.push(o);
  }

  const chosen = options.filter((o) => sel.has(o.value));
  const allOn = options.length > 0 && chosen.length === options.length;
  let summary;
  if (!options.length) summary = emptyText || `No ${nouns}`;
  else if (allOn) summary = `All ${nouns} (${options.length})`;
  else if (!chosen.length) summary = `Choose ${nouns}…`;
  else if (chosen.length <= 2) summary = chosen.map((o) => o.label).join(", ");
  else summary = `${chosen.length} of ${options.length} ${nouns}`;

  const toggle = (values, on) => {
    const next = new Set(sel);
    for (const v of values) (on ? next.add(v) : next.delete(v));
    onChange(options.map((o) => o.value).filter((v) => next.has(v))); // keep list order
  };

  return (
    <div className="field multi" ref={box}>
      <span className="field-label">{label}</span>
      <button type="button" className={`multi-btn${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)}
        disabled={disabled || !options.length} aria-expanded={open} aria-haspopup="listbox">
        <span className="multi-summary">{summary}</span>
      </button>
      {open && (
        <div className="multi-pop" role="listbox" aria-multiselectable="true" aria-label={label}>
          <input className="input multi-search" type="search" autoFocus placeholder={`Search ${nouns}…`}
            value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${nouns}`} />
          <div className="multi-list">
            {!q && (
              <label className="multi-opt multi-all">
                <input type="checkbox" checked={allOn}
                  ref={(el) => { if (el) el.indeterminate = !allOn && chosen.length > 0; }}
                  onChange={(e) => toggle(options.map((o) => o.value), e.target.checked)} />
                <span>All {nouns}</span><small>{options.length}</small>
              </label>
            )}
            {groups.map((g) => {
              const on = g.items.filter((o) => sel.has(o.value)).length;
              return (
                <div key={g.name || "_"}>
                  {g.name && (
                    <label className="multi-opt multi-group">
                      <input type="checkbox" checked={on === g.items.length}
                        ref={(el) => { if (el) el.indeterminate = on > 0 && on < g.items.length; }}
                        onChange={(e) => toggle(g.items.map((o) => o.value), e.target.checked)} />
                      <span>{g.name}</span><small>{on}/{g.items.length}</small>
                    </label>
                  )}
                  {g.items.map((o) => (
                    <label key={o.value} className={`multi-opt${g.name ? " in-group" : ""}`}>
                      <input type="checkbox" checked={sel.has(o.value)} onChange={(e) => toggle([o.value], e.target.checked)} />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {!shown.length && <div className="empty-state">No match for “{query}”.</div>}
          </div>
          {q && shown.length > 0 && (
            <div className="multi-foot">
              <button type="button" className="mini-btn" onClick={() => toggle(shown.map((o) => o.value), true)}>Select shown ({shown.length})</button>
              <button type="button" className="mini-btn" onClick={() => toggle(shown.map((o) => o.value), false)}>Clear shown</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
