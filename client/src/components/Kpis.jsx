import { pct, plural } from "../lib/helpers";
import { BuildingIcon, CheckIcon, ClockIcon, StarIcon } from "./Icons";

function Kpi({ icon, tone, label, value, sub, children }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="eyebrow">{label}</span>
        <span className={`kpi-icon ${tone}`}>{icon}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {children}
      <div className="kpi-sub" title={sub}>{sub}</div>
    </div>
  );
}

export default function Kpis({ rows, metrics, helpers, scopeSub }) {
  let applicable = 0, done = 0, pendingEntries = 0, complete = 0, withPending = 0;
  for (const r of rows) {
    let rowApplicable = 0, rowDone = 0, rowPending = false;
    for (const m of metrics) {
      const v = r.values[m.key];
      if (helpers.isNA(v)) continue;
      rowApplicable++; applicable++;
      if (helpers.isDone(v)) { rowDone++; done++; }
      if (helpers.isPending(v)) { pendingEntries++; rowPending = true; }
    }
    if (rowPending) withPending++;
    if (rowApplicable && rowApplicable === rowDone) complete++;
  }
  const rate = pct(done, applicable);

  return (
    <section className="kpis" aria-label="Key figures">
      <Kpi icon={<BuildingIcon />} tone="brand" label="Jamaats" value={rows.length} sub={scopeSub} />
      <Kpi icon={<CheckIcon />} tone="good" label="Completion rate" value={<>{rate}<small>%</small></>}
        sub={`${done} of ${applicable} applicable entries done`}>
        <div className="progress" role="progressbar" aria-valuenow={rate} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${rate}%` }} />
        </div>
      </Kpi>
      <Kpi icon={<ClockIcon />} tone="warn" label="Pending entries" value={pendingEntries} sub={`in ${plural(withPending, "Jamaat")}`} />
      <Kpi icon={<StarIcon />} tone="good" label="Fully complete" value={complete}
        sub={`of ${plural(rows.length, "Jamaat")} · every activity done`} />
    </section>
  );
}
