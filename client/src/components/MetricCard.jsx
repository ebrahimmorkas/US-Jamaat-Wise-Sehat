import { NOT_FILLED, pct, plural, same } from "../lib/helpers";

function distribution(metric, rows, helpers) {
  const set = helpers.statusesFor(metric);
  const counts = new Map(set.map((s) => [s, 0]));
  let empty = 0, other = 0;
  for (const r of rows) {
    const v = r.values[metric.key];
    if (!v) { empty++; continue; }
    const s = set.find((x) => same(x, v));
    if (s) counts.set(s, counts.get(s) + 1);
    else other++;
  }
  const segs = set.map((s) => ({ status: s, count: counts.get(s), selectable: true }));
  segs.push({ status: NOT_FILLED, count: empty, selectable: true }); // no form submitted yet
  if (other) segs.push({ status: "Other", count: other, selectable: false });
  return segs;
}

export default function MetricCard({ metric, rows, helpers, status, onStatus, onOpen, onTip, onTipHide }) {
  const total = rows.length;
  const segs = distribution(metric, rows, helpers);
  const n = (segs.find((s) => s.status === status) || { count: 0 }).count;
  const tone = helpers.toneOf(status, metric);
  const summary = segs.map((s) => `${s.status} ${s.count}`).join(", ");

  const pick = (seg) => {
    onTipHide();
    if (seg.selectable) onStatus(seg.status);
    else onOpen(seg.status); // "Not filled" / "Other": show the list directly
  };

  return (
    <article className="card">
      <header className="card-head">
        <div className="eyebrow">{metric.group}</div>
        <h3>{metric.label}</h3>
      </header>

      <div className="card-main">
        <button type="button" className="card-value" onClick={() => onOpen(status)} title="Show these Jamaats">
          <span className={`value tone-text-${tone}`}>{n}</span>
          <span className="value-sub"><b>{pct(n, total)}%</b> of {total}</span>
        </button>
        <select className="status-select" value={status} onChange={(e) => onStatus(e.target.value)}
          aria-label={`${metric.label}: status to count`}>
          {[...helpers.statusesFor(metric), NOT_FILLED].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="stack" role="img" aria-label={`${metric.label} status split: ${summary}`} onPointerLeave={onTipHide}>
        {segs.filter((s) => s.count > 0).map((s) => (
          <span key={s.status} className={`seg tone-${helpers.toneOf(s.status, metric)}`} style={{ flex: s.count }}
            onClick={() => pick(s)}
            onPointerMove={(e) => onTip(e, <>{s.status}: <b>{s.count}</b> ({pct(s.count, total)}%)</>)} />
        ))}
      </div>

      <div className="legend">
        {segs.map((s) => (
          <button type="button" key={s.status} className={`lg-item${s.status === status ? " is-sel" : ""}`} onClick={() => pick(s)}>
            <span className={`dot tone-${helpers.toneOf(s.status, metric)}`} />
            {s.status} <b>{s.count}</b>
          </button>
        ))}
      </div>

      <button type="button" className="card-link" onClick={() => onOpen(status)}>
        View {n ? plural(n, "Jamaat") : "list"} <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}
