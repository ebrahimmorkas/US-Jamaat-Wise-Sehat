import { ALL, NOT_FILLED, pct, plural } from "../lib/helpers";
import { ChevronLeft, ChevronRight } from "./Icons";
import StatusPill from "./StatusPill";

export default function SidePanel({ jamiats, rows, jamiat, jamaat, metrics, helpers, onJamiat, onJamaat }) {
  const activities = plural(metrics.length, "activity", "activities");
  // Every answer expected from these Jamaats: done / not done yet / not applicable / not filled.
  const progressOf = (list) => {
    let done = 0, open = 0, na = 0, empty = 0, submitted = 0;
    for (const jm of list) {
      if (jm.submittedAt) submitted++;
      for (const m of metrics) {
        const v = jm.values[m.key];
        if (!v) empty++;
        else if (helpers.isDone(v, m)) done++;
        else if (helpers.isNA(v, m)) na++;
        else open++;
      }
    }
    return { done, open, na, empty, submitted, rate: pct(done, done + open + empty) };
  };

  const back =
    jamiat === ALL ? null : (
      <button type="button" className="back-btn" onClick={() => (jamaat !== ALL ? onJamiat(jamiat) : onJamiat(ALL))}>
        <ChevronLeft />
        <span>{jamaat !== ALL ? `All Jamaats in ${jamiat}` : "All Jamiats"}</span>
      </button>
    );

  let title, sub, body;

  if (jamiat !== ALL && jamaat !== ALL) {
    // ---- one Jamaat: checklist + previous / next ----
    const r = rows[0];
    const siblings = (jamiats.find((j) => j.name === jamiat) || { jamaats: [] }).jamaats.map((x) => x.name);
    const at = siblings.indexOf(jamaat);
    const prev = siblings[at - 1];
    const next = siblings[at + 1];
    title = "Status checklist";
    sub = `${jamaat} · all ${activities}`;
    body = !r ? (
      <div className="empty-state">No data for this Jamaat.</div>
    ) : (
      <>
        <ul className="check-list">
          {metrics.map((m) => {
            const v = r.values[m.key] || NOT_FILLED;
            return (
              <li key={m.key}>
                <span><span className="name">{m.label}</span><span className="grp">{m.group}</span></span>
                <StatusPill status={v} tone={helpers.toneOf(v, m)} />
              </li>
            );
          })}
        </ul>
        {r.remarks && (
          <div className="remarks"><div className="eyebrow">Remarks / next action</div>{r.remarks}</div>
        )}
        <div className="step-nav">
          <button type="button" className="step-btn" disabled={!prev} title={prev || ""} onClick={() => onJamaat(prev)}>
            <ChevronLeft size={14} /><span>{prev || "Previous"}</span>
          </button>
          <button type="button" className="step-btn next" disabled={!next} title={next || ""} onClick={() => onJamaat(next)}>
            <span>{next || "Next"}</span><ChevronRight size={14} />
          </button>
        </div>
      </>
    );
  } else {
    // ---- progress: Jamiats (All) or Jamaats of one Jamiat, in name order ----
    const byJamiat = jamiat === ALL;
    const items = (byJamiat
      ? jamiats.map((j) => ({ name: j.name, p: progressOf(j.jamaats), count: j.jamaats.length }))
      : rows.map((r) => ({ name: r.name, p: progressOf([r]), count: 1 }))
    ).sort((a, b) => a.name.localeCompare(b.name));
    const subOf = ({ p, count }) =>
      byJamiat
        ? `${p.submitted}/${count} submitted${p.open ? ` · ${p.open} not done` : ""}`
        : !p.submitted ? "Not submitted" : p.open ? `${p.open} not done yet` : "All done";
    title = byJamiat ? "Progress by Jamiat" : "Progress by Jamaat";
    sub = `Answers done across all ${activities} · click to open`;
    body = items.length ? (
      <>
        <div className="q-legend rank-legend" aria-hidden="true">
          <span><span className="dot tone-good" />Done</span>
          <span><span className="dot tone-warn" />Not done yet</span>
          <span><span className="dot tone-na" />Not applicable</span>
          <span><span className="dot tone-empty" />Not filled</span>
        </div>
        {items.map((i) => {
          const { p } = i;
          const label = `${i.name}: ${p.rate}% done — ${p.done} done, ${p.open} not done yet, ${p.na} not applicable, ${p.empty} not filled`;
          return (
            <button type="button" key={i.name} className={`rank-row${p.submitted ? "" : " zero"}`} title={label} aria-label={`Open ${label}`}
              onClick={() => {
                if (byJamiat) onJamiat(i.name); else onJamaat(i.name);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}>
              <span className="rank-name">{i.name}<small>{subOf(i)}</small></span>
              <span className="rank-val">{p.rate}%</span>
              <span className="rank-bar stack">
                {p.done > 0 && <span className="seg tone-good" style={{ flexGrow: p.done }} />}
                {p.open > 0 && <span className="seg tone-warn" style={{ flexGrow: p.open }} />}
                {p.na > 0 && <span className="seg tone-na" style={{ flexGrow: p.na }} />}
                {p.empty > 0 && <span className="seg tone-empty" style={{ flexGrow: p.empty }} />}
              </span>
            </button>
          );
        })}
      </>
    ) : (
      <div className="empty-state">No Jamaats found.</div>
    );
  }

  return (
    <aside className="panel panel-side">
      <div className="panel-head">
        <div>
          {back}
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </div>
      <div className="side-body">{body}</div>
    </aside>
  );
}
