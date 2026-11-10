import { pct } from "../lib/helpers";
import { BuildingIcon, CheckIcon } from "./Icons";

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

export default function Kpis({ rows, metrics, helpers, scopeSub, submitted, monthLabel }) {
  let applicable = 0, done = 0;
  for (const r of rows) {
    for (const m of metrics) {
      const v = r.values[m.key];
      if (!v || helpers.isNA(v)) continue;
      applicable++;
      if (helpers.isDone(v)) done++;
    }
  }
  const rate = pct(done, applicable);

  return (
    <section className="kpis" aria-label="Key figures">
      <Kpi icon={<BuildingIcon />} tone="brand" label="Jamaats" value={rows.length}
        sub={`${scopeSub} · ${submitted} submitted for ${monthLabel}`} />
      <Kpi icon={<CheckIcon />} tone="good" label="Completion rate" value={<>{rate}<small>%</small></>}
        sub={`${done} of ${applicable} applicable answers done`}>
        <div className="progress" role="progressbar" aria-valuenow={rate} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${rate}%` }} />
        </div>
      </Kpi>
    </section>
  );
}
