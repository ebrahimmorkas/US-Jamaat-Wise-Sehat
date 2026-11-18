import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { DownloadIcon } from "./components/Icons";
import { AuthError, downloadData, fetchData, isServerStarting, setDataCell } from "./lib/api";
import { choiceStyle } from "./lib/dataColors";
import { plural } from "./lib/helpers";
import { JC_NAV } from "./JcDashboard";

const fmtWhen = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

// JC Portal › Data: the Super Admin's Excel data for this JC's own Jamaats, Jamiat by Jamiat.
// Columns come from the uploaded file. Dropdown columns can be changed here (saved at once).
export default function JcData({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [jamiat, setJamiat] = useState("");
  const [jamaat, setJamaat] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState({}); // rowId:col -> true
  const [downloading, setDownloading] = useState(false);
  const retry = useRef(null);

  const load = useCallback(async (tries = 0) => {
    setLoading(true);
    try {
      const d = await fetchData();
      setData(d);
      setError("");
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setError("Connecting to the server…");
        retry.current = setTimeout(() => load(tries + 1), 5000);
        return;
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); return () => clearTimeout(retry.current); }, [load]);

  // Every column, in the file's order (as in the Excel).
  const cols = useMemo(() => (data ? data.columns.map((c, i) => ({ ...c, i })) : []), [data]);
  const groups = useMemo(() => (data ? data.jamiats : []), [data]);
  const jamaatOptions = useMemo(() => groups.filter((g) => !jamiat || g.id === jamiat).flatMap((g) => g.jamaats), [groups, jamiat]);

  // Filters: Jamiat, Jamaat, search (any cell).
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => !jamiat || g.id === jamiat)
      .map((g) => ({
        ...g,
        jamaats: g.jamaats
          .filter((m) => !jamaat || m.id === jamaat)
          .map((m) => ({ ...m, rows: q ? m.rows.filter((r) => m.name.toLowerCase().includes(q) || r.cells.some((c) => String(c).toLowerCase().includes(q))) : m.rows }))
          .filter((m) => m.rows.length),
      }))
      .filter((g) => g.jamaats.length);
  }, [groups, jamiat, jamaat, query]);
  const total = groups.reduce((n, g) => n + g.jamaats.reduce((m, x) => m + x.rows.length, 0), 0);
  // One table like the Excel: rows in the file's order.
  const flat = useMemo(() => shown.flatMap((g) => g.jamaats.flatMap((m) => m.rows.map((r) => ({ ...r, jamaatName: m.name })))).sort((a, b) => a.order - b.order), [shown]);
  const shownRows = flat.length;

  // How many cells have each choice (in the rows shown).
  const counts = useMemo(() => {
    const out = {};
    if (!data) return out;
    const drop = cols.filter((c) => c.dropdown);
    for (const r of flat) for (const c of drop) {
      const v = r.cells[c.i] || "";
      out[v] = (out[v] || 0) + 1;
    }
    return out;
  }, [flat, cols, data]);

  const setCell = (rowId, i, value) => setData((d) => ({
    ...d,
    jamiats: d.jamiats.map((g) => ({ ...g, jamaats: g.jamaats.map((m) => ({ ...m, rows: m.rows.map((r) => (r.id === rowId ? { ...r, cells: r.cells.map((c, k) => (k === i ? value : c)) } : r)) })) })),
  }));

  const change = async (row, i, value) => {
    const before = row.cells[i] || "";
    const key = `${row.id}:${i}`;
    setCell(row.id, i, value);
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      await setDataCell(row.id, i, value, data.version);
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      setCell(row.id, i, before);
      setMsg({ type: "error", text: `Not saved: ${err.message}`, reload: err.status === 409 });
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadData();
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      setMsg({ type: "error", text: `Could not download: ${err.message}` });
    } finally {
      setDownloading(false);
    }
  };

  const choices = data ? data.choices : [];
  const hasDrop = cols.some((c) => c.dropdown);

  return (
    <div className="portal">
      <AppBar title="JC Portal" subtitle="Monthly Jamaat follow-up" nav={JC_NAV} page="/jc-portal/data"
        theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />

      <main className="container jc-data">
        <section className="page-head">
          <div className="page-title">
            <h1>Data</h1>
            <p className="page-sub">
              {data && data.hasData
                ? <>Data for your Jamaats{data.uploadedAt ? `, updated ${fmtWhen(data.uploadedAt)}` : ""}.{hasDrop ? " Coloured columns can be changed; changes save at once." : ""}</>
                : "Data for your Jamaats."}
            </p>
          </div>
          {data && total > 0 && (
            <button type="button" className={`btn btn-ghost${downloading ? " loading" : ""}`} onClick={download} disabled={downloading} title="Download Excel" aria-label="Download Excel">
              <DownloadIcon /><span>Download Excel</span>
            </button>
          )}
        </section>

        {error && <Notice type={data ? "error" : "info"} text={error} onClose={data ? () => setError("") : undefined} />}
        {msg && (
          <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)}>
            {msg.reload && <button type="button" className="btn btn-ghost" onClick={() => { setMsg(null); load(); }}>Reload</button>}
          </Notice>
        )}

        {!data ? (
          !error && <div className="panel portal-empty">{loading ? "Loading…" : ""}</div>
        ) : !data.hasData ? (
          <div className="panel portal-empty">No data has been uploaded yet.</div>
        ) : !total ? (
          <div className="panel portal-empty">There is no data for your Jamaats in the current file.</div>
        ) : (
          <>
            <section className="panel data-tools" aria-label="Filters">
              {groups.length > 1 && (
                <label className="field">
                  <span className="field-label">Jamiat</span>
                  <select value={jamiat} onChange={(e) => { setJamiat(e.target.value); setJamaat(""); }}>
                    <option value="">All my Jamiats</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
              )}
              <label className="field">
                <span className="field-label">Jamaat</span>
                <select value={jamaat} onChange={(e) => setJamaat(e.target.value)}>
                  <option value="">All</option>
                  {jamaatOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="field data-search">
                <span className="field-label">Search</span>
                <input className="input" type="search" value={query} placeholder="Search any column…" onChange={(e) => setQuery(e.target.value)} />
              </label>
              {hasDrop && (
                <div className="data-legend" aria-label="Choices">
                  {choices.map((c) => (
                    <span key={c.id} className="dchip" style={choiceStyle(data.palette, choices, c.value)}>{c.value} <b>{counts[c.value] || 0}</b></span>
                  ))}
                  {(() => {
                    const other = Object.entries(counts).filter(([k]) => k && !choices.some((c) => c.value === k)).reduce((n, [, x]) => n + x, 0);
                    return other > 0 && <span className="dchip empty" title="Values from the Excel file that are not one of the choices">Other values <b>{other}</b></span>;
                  })()}
                  <span className="dchip empty">Not set <b>{counts[""] || 0}</b></span>
                </div>
              )}
            </section>

            <p className="data-count muted">{shownRows === total ? plural(total, "row") : `${shownRows} of ${plural(total, "row")}`}</p>

            {!flat.length ? <div className="panel portal-empty">Nothing matches the filters.</div> : (
              <section className="panel data-sheet">
                <div className="data-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>{cols.map((c) => <th key={c.i} className={c.dropdown ? "is-drop" : ""}>{c.name}</th>)}</tr>
                    </thead>
                    <tbody>
                      {flat.map((r) => (
                        <tr key={r.id}>
                          {cols.map((c) => {
                            const v = r.cells[c.i] || "";
                            if (!c.dropdown) return <td key={c.i}>{v}</td>;
                            const busy = saving[`${r.id}:${c.i}`];
                            return (
                              <td key={c.i} className="is-drop">
                                <select className={`dsel${choiceStyle(data.palette, choices, v) ? " has" : v ? " is-file" : ""}${busy ? " is-saving" : ""}`} value={v} style={choiceStyle(data.palette, choices, v)}
                                  aria-label={`${c.name} for ${r.jamaatName}`} onChange={(e) => change(r, c.i, e.target.value)}>
                                  <option value="">Not set</option>
                                  {v && !choices.some((ch) => ch.value === v) && <option value={v}>{v}</option>}
                                  {choices.map((ch) => <option key={ch.id} value={ch.value}>{ch.value}</option>)}
                                </select>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
