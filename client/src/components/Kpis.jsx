import { pct } from "../lib/helpers";
import { BuildingIcon, CheckIcon, ClockIcon } from "./Icons";

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

// Top of the Sahebo Dashboard: how many Jamaats are in view and how many have submitted the month's form.
export default function Kpis({ rows, scopeSub, submitted, monthLabel }) {
  const total = rows.length;
  const left = total - submitted;
  return (
    <section className="kpis kpis-3" aria-label="Key figures">
      <Kpi icon={<BuildingIcon />} tone="brand" label="Jamaats" value={total} sub={scopeSub} />
      <Kpi icon={<CheckIcon />} tone="good" label="Forms submitted" value={<>{submitted}<small>/ {total}</small></>}
        sub={`${pct(submitted, total)}% submitted for ${monthLabel}`}>
        <Bar value={pct(submitted, total)} label="Forms submitted" />
      </Kpi>
      <Kpi icon={<ClockIcon />} tone="warn" label="Not submitted yet" value={left}
        sub={left ? `still to submit for ${monthLabel}` : `all submitted for ${monthLabel}`} />
    </section>
  );
}
