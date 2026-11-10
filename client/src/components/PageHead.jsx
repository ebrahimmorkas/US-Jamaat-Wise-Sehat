import { ALL } from "../lib/helpers";

export default function PageHead({ month, months, onMonth, jamiat, jamaat, jamiatNames, jamaatNames, onJamiat, onJamaat }) {
  const monthLabel = (months.find((m) => m.key === month) || {}).label;
  return (
    <section className="page-head">
      <div className="page-title">
        <nav className="crumbs" aria-label="Current view">
          {jamiat === ALL ? (
            <span className="current">All Jamiats</span>
          ) : (
            <>
              <button type="button" onClick={() => onJamiat(ALL)}>All Jamiats</button>
              <span className="sep">›</span>
              {jamaat === ALL ? (
                <span className="current">{jamiat}</span>
              ) : (
                <>
                  <button type="button" onClick={() => onJamiat(jamiat)}>{jamiat}</button>
                  <span className="sep">›</span>
                  <span className="current">{jamaat}</span>
                </>
              )}
            </>
          )}
        </nav>
        <h1>
          Sahebo Dashboard {monthLabel && <span className="chip">{monthLabel}</span>}
        </h1>
      </div>

      <div className="filters" role="group" aria-label="Filters">
        {months.length > 0 && (
          <label className="field field-month">
            <span className="field-label">Month</span>
            <select value={month} onChange={(e) => onMonth(e.target.value)}>
              {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Jamiat</span>
          <select value={jamiat} onChange={(e) => onJamiat(e.target.value)}>
            {[ALL, ...jamiatNames].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {jamiat !== ALL && (
          <label className="field">
            <span className="field-label">Jamaat</span>
            <select value={jamaat} onChange={(e) => onJamaat(e.target.value)}>
              {[ALL, ...jamaatNames].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
    </section>
  );
}
