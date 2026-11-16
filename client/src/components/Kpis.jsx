import { pct, plural } from "../lib/helpers";
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

const Bar = ({ value, label }) => (
  <div className="progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${value}%` }} />
  </div>
);

export default function Kpis({ rows, metrics, helpers, scopeSub, submitted, monthLabel }) {
  let applicable = 0, done = 0;
  for (const r of rows) {
    for (const m of metrics) {
      const v = r.values[m.key];
      if (!v || helpers.isNA(v, m)) continue;
      applicable++;
      if (helpers.isDone(v, m)) done++;
    }
  }
  const rate = pct(done, applicable);

  return (
    <section className="kpis" aria-label="Key figures">
      <Kpi icon={<BuildingIcon />} tone="brand" label="Forms submitted" value={<>{submitted}<small>/ {rows.length}</small></>}
        sub={`${plural(rows.length, "Jamaat")} ${scopeSub.startsWith("in ") || scopeSub.startsWith("across ") ? scopeSub : `· ${scopeSub}`} · ${monthLabel}`}>
        <Bar value={pct(submitted, rows.length)} label="Forms submitted" />
      </Kpi>
      <Kpi icon={<CheckIcon />} tone="good" label="Completion rate" value={<>{rate}<small>%</small></>}
        sub={`${done} of ${applicable} applicable answers done${submitted < rows.length ? " (submitted forms)" : ""}`}>
        <Bar value={rate} label="Completion rate" />
      </Kpi>
    </section>
  );
}
