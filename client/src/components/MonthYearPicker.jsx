// Hijri Month + Year picker. `months` = [{ key: "YYYY-MM", label, name, range }] the server allows
// (newest first, never a future month for the JC portal); `value` = the chosen key. The year starts on
// the current Hijri year (the server's default month). Changing the year keeps the same month when that
// year has it, otherwise the nearest one. Under the pickers: the English dates the month covers.
const split = (key) => { const [y, m] = String(key || "").split("-"); return { y, m }; };

export default function MonthYearPicker({ months, value, onChange, label = "Month", className = "", showRange = true }) {
  const list = months || [];
  const keys = list.map((x) => x.key);
  if (!keys.length) return null;
  const chosen = keys.includes(value) ? value : keys[0];
  const cur = split(chosen);
  const info = list.find((x) => x.key === chosen) || {};
  const nameOf = (m) => (list.find((x) => split(x.key).m === m) || {}).name || m;
  const years = [...new Set(keys.map((k) => split(k).y))].sort().reverse();       // newest first
  const inYear = (y) => keys.filter((k) => split(k).y === y).map((k) => split(k).m).sort(); // 1st..12th month

  const pickYear = (y) => {
    const ms = inYear(y);
    if (!ms.length) return;
    const m = ms.includes(cur.m) ? cur.m
      : ms.reduce((best, x) => (Math.abs(+x - +cur.m) < Math.abs(+best - +cur.m) ? x : best), ms[0]);
    onChange(`${y}-${m}`);
  };

  return (
    <div className={`field field-month ${className}`} role="group" aria-label={label}>
      <span className="field-label">{label} <span className="optional">(Hijri)</span></span>
      <div className="my-pick">
        <select value={cur.m} onChange={(e) => onChange(`${cur.y}-${e.target.value}`)} aria-label="Hijri month">
          {inYear(cur.y).map((m) => <option key={m} value={m}>{nameOf(m)}</option>)}
        </select>
        <select value={cur.y} onChange={(e) => pickYear(e.target.value)} aria-label="Hijri year" disabled={years.length < 2}>
          {years.map((y) => <option key={y} value={y}>{y} H</option>)}
        </select>
      </div>
      {showRange && info.range && <span className="field-hint">{info.range}</span>}
    </div>
  );
}
