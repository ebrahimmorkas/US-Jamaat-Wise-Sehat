// Month + Year picker. `months` = [{ key: "YYYY-MM", label }] the server allows (newest first, never a
// future month); `value` = the chosen key. The year starts on the current year (the server's default
// month). Changing the year keeps the same month when that year has it, otherwise the nearest one.
const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const split = (key) => { const [y, m] = String(key || "").split("-"); return { y, m }; };

export default function MonthYearPicker({ months, value, onChange, label = "Month", className = "" }) {
  const keys = (months || []).map((x) => x.key);
  if (!keys.length) return null;
  const cur = keys.includes(value) ? split(value) : split(keys[0]);
  const years = [...new Set(keys.map((k) => split(k).y))].sort().reverse();       // newest first
  const inYear = (y) => keys.filter((k) => split(k).y === y).map((k) => split(k).m).sort(); // Jan..Dec

  const pickYear = (y) => {
    const ms = inYear(y);
    if (!ms.length) return;
    const m = ms.includes(cur.m) ? cur.m
      : ms.reduce((best, x) => (Math.abs(+x - +cur.m) < Math.abs(+best - +cur.m) ? x : best), ms[0]);
    onChange(`${y}-${m}`);
  };

  return (
    <div className={`field field-month ${className}`} role="group" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="my-pick">
        <select value={cur.m} onChange={(e) => onChange(`${cur.y}-${e.target.value}`)} aria-label="Month">
          {inYear(cur.y).map((m) => <option key={m} value={m}>{NAMES[+m - 1]}</option>)}
        </select>
        <select value={cur.y} onChange={(e) => pickYear(e.target.value)} aria-label="Year" disabled={years.length < 2}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}
