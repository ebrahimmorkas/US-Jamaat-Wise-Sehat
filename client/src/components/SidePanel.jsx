import { ALL, NOT_FILLED, plural } from "../lib/helpers";
import { ChevronLeft, ChevronRight } from "./Icons";
import StatusPill from "./StatusPill";

export default function SidePanel({ jamiats, rows, jamiat, jamaat, metrics, helpers, onJamiat, onJamaat }) {
  const activities = plural(metrics.length, "activity", "activities");
  const pendingIn = (list) =>
    list.reduce((sum, jm) => sum + metrics.filter((m) => helpers.isPending(jm.values[m.key], m)).length, 0);

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
    // ---- ranking: Jamiats (All) or Jamaats of one Jamiat ----
    const byJamiat = jamiat === ALL;
    const items = (byJamiat
      ? jamiats.map((j) => ({ name: j.name, sub: plural(j.jamaats.length, "Jamaat"), value: pendingIn(j.jamaats) }))
      : rows.map((r) => ({ name: r.name, sub: "", value: pendingIn([r]) }))
    ).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const max = Math.max(1, ...items.map((i) => i.value));
    title = byJamiat ? "Pending by Jamiat" : "Pending by Jamaat";
    sub = `Pending entries across all ${activities} · click to open`;
    body = items.length ? (
      items.map((i) => (
        <button type="button" key={i.name} className={`rank-row${i.value ? "" : " zero"}`} title={`Open ${i.name}`}
          onClick={() => {
            if (byJamiat) onJamiat(i.name); else onJamaat(i.name);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}>
          <span className="rank-name">{i.name}{i.sub && <small>{i.sub}</small>}</span>
          <span className="rank-val">{i.value}</span>
          <span className="rank-bar"><span style={{ width: `${(i.value / max) * 100}%` }} /></span>
        </button>
      ))
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
