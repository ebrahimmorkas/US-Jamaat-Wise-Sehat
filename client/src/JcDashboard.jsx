import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import MonthYearPicker from "./components/MonthYearPicker";
import { BuildingIcon, CheckIcon, ClockIcon, StarIcon } from "./components/Icons";
import { AuthError, isServerStarting, portalSummary } from "./lib/api";
import { useRealtime, useRealtimeStatus } from "./hooks/useRealtime";
import { navigate } from "./lib/router";
import { pct, plural, same } from "./lib/helpers";

export const JC_NAV = [{ to: "/jc-portal", label: "Dashboard" }, { to: "/jc-portal/form", label: "Fill form" }];
const LIVE_DEBOUNCE_MS = 400;

// Work state of one Jamaat for the month.
const STATE = {
  todo: { label: "Not submitted", tone: "warn", rank: 0 },
  follow: { label: "Needs follow-up", tone: "info", rank: 1 },
  done: { label: "All done", tone: "good", rank: 2 },
};
const FILTERS = [["all", "All"], ["todo", "Not submitted"], ["follow", "Needs follow-up"], ["done", "All done"]];

const fmtDate = (d) => new Date(d).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// For each Jamaat: done / applicable answers and the answers still open (pending, in progress, not done).
function analyse(jamaats, questions) {
  return jamaats.map((jm) => {
    let applicable = 0, done = 0;
    const open = [];
    for (const q of questions) {
      const v = jm.values[q.key];
      if (!v) continue;
      const opt = q.options.find((o) => same(o.value, v));
      const tone = opt ? opt.tone : "na";
      if (tone === "na") continue;
      applicable++;
      if (q.done.some((d) => same(d, v))) done++;
      else open.push({ key: q.key, label: q.label, value: v, tone });
    }
    const state = !jm.submittedAt ? "todo" : open.length ? "follow" : "done";
    return { ...jm, applicable, done, open, state };
  });
}

// JC home: how the JC's own Jamaats stand for a month, and what is left to do. Live.
export default function JcDashboard({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const [month, setMonth] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [question, setQuestion] = useState(""); // show only Jamaats open on this question
  const [jamiat, setJamiat] = useState("");
  const [q, setQ] = useState("");
  const live = useRealtimeStatus();

  const monthRef = useRef(month);
  monthRef.current = month;
  const dataRef = useRef(data);
  dataRef.current = data;
  const expiredRef = useRef(onAuthExpired);
  expiredRef.current = onAuthExpired;
  const seq = useRef(0);
  const timer = useRef(null);
  const retryTimer = useRef(null);

  const load = useCallback(async (tries = 0) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const body = await portalSummary(monthRef.current);
      if (my !== seq.current) return;
      setData(body);
      setError("");
      setLoading(false);
    } catch (err) {
      if (my !== seq.current) return;
      if (err instanceof AuthError) return expiredRef.current();
      if (!dataRef.current && isServerStarting(err) && tries < 24) {
        setError("Connecting to the server…");
        retryTimer.current = setTimeout(() => load(tries + 1), 5000);
        return;
      }
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, month]);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(retryTimer.current); }, []);
  useEffect(() => {
    const before = document.title;
    document.title = "JC Dashboard · Umoor Sehhat";
    return () => { document.title = before; };
  }, []);

  const reloadSoon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => load(), LIVE_DEBOUNCE_MS);
  }, [load]);

  // A save by anyone (e.g. another JC of the same Jamaat) or a Super Admin change -> reload.
  useRealtime("portal", "portal:changed", (evt) => {
    const d = dataRef.current;
    if (evt && evt.reason === "entry" && d && (evt.month !== d.month || !d.jamaats.some((j) => j.id === evt.jamaat))) return;
    reloadSoon();
  }, { onReconnect: reloadSoon });

  const rows = useMemo(() => (data ? analyse(data.jamaats, data.questions) : []), [data]);
  const jamiats = useMemo(() => [...new Map(rows.map((r) => [r.jamiatId, r.jamiat])).entries()], [rows]);
  const scoped = jamiat ? rows.filter((r) => r.jamiatId === jamiat) : rows;

  const counts = { all: scoped.length, todo: 0, follow: 0, done: 0 };
  let applicable = 0, done = 0;
  for (const r of scoped) { counts[r.state]++; applicable += r.applicable; done += r.done; }
  const submitted = counts.follow + counts.done;
  const rate = pct(done, applicable);

  // Per question: how many submitted Jamaats are done / still open / not applicable.
  const perQuestion = useMemo(() => {
    if (!data) return [];
    return data.questions.map((qq) => {
      let d = 0, o = 0, na = 0;
      for (const r of scoped) {
        const v = r.values[qq.key];
        if (!v) continue;
        if (qq.done.some((x) => same(x, v))) d++;
        else if ((qq.options.find((x) => same(x.value, v)) || { tone: "na" }).tone === "na") na++;
        else o++;
      }
      return { ...qq, d, o, na };
    });
  }, [data, scoped]);

  const needle = q.trim().toLowerCase();
  const list = scoped
    .filter((r) => filter === "all" || r.state === filter)
    .filter((r) => !question || r.open.some((x) => x.key === question))
    .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.jamiat.toLowerCase().includes(needle))
    .sort((a, b) => STATE[a.state].rank - STATE[b.state].rank || a.jamiat.localeCompare(b.jamiat) || a.name.localeCompare(b.name));
  const questionLabel = question && (data.questions.find((x) => x.key === question) || {}).label;

  const open = (r) => navigate(`/jc-portal/form?jamaat=${encodeURIComponent(r.id)}&month=${encodeURIComponent(data.month)}`);

  return (
    <div className="portal">
      <AppBar title="JC Portal" subtitle="Monthly Jamaat follow-up" nav={JC_NAV} page="/jc-portal"
        sync={{ syncedAt: data && data.loadedAt, loading, failed: !!error && !data, live, onRefresh: () => load() }}
        theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />

      <main className="container jc-dash">
        <section className="page-head">
          <div className="page-title">
            <h1>My Jamaats {data && <span className="chip">{data.monthLabel}</span>}</h1>
            <p className="page-sub">Only the Jamaats assigned to you. Updates live as forms are saved.</p>
          </div>
          {data && (
            <div className="filters">
              <MonthYearPicker months={data.months} value={data.month} onChange={setMonth} />
              {jamiats.length > 1 && (
                <label className="field">
                  <span className="field-label">Jamiat</span>
                  <select value={jamiat} onChange={(e) => setJamiat(e.target.value)}>
                    <option value="">All my Jamiats</option>
                    {jamiats.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </section>

        {error && <Notice type={data ? "error" : "info"} text={error} onClose={data ? () => setError("") : undefined} />}

        {!data ? (
          !error && <div className="panel portal-empty">Loading…</div>
        ) : !rows.length ? (
          <div className="panel portal-empty">No Jamaats are assigned to you yet. Please contact the Super Admin.</div>
        ) : (
          <>
            <section className="kpis jc-kpis" aria-label="Key figures">
              <Kpi icon={<BuildingIcon />} tone="brand" label="My Jamaats" value={scoped.length}
                sub={jamiat ? (jamiats.find(([id]) => id === jamiat) || [])[1] : `in ${plural(jamiats.length, "Jamiat")}`} />
              <Kpi icon={<CheckIcon />} tone="good" label="Submitted" value={<>{submitted}<small>/ {scoped.length}</small></>}
                sub={counts.todo ? `${counts.todo} still to submit for ${data.monthLabel}` : `All submitted for ${data.monthLabel}`}>
                <Bar value={pct(submitted, scoped.length)} label="Submitted" />
              </Kpi>
              <Kpi icon={<StarIcon />} tone="good" label="Completion rate" value={<>{rate}<small>%</small></>}
                sub={`${done} of ${applicable} applicable answers done`}>
                <Bar value={rate} label="Completion rate" />
              </Kpi>
              <Kpi icon={<ClockIcon />} tone="warn" label="Needs follow-up" value={counts.follow}
                sub={counts.follow ? "submitted, with answers not done yet" : "nothing pending in submitted forms"} />
            </section>

            <section className="layout">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Jamaats</h2>
                    <p>Not submitted first, then the ones that need follow-up. Click Fill or Update to open the form.</p>
                  </div>
                </div>
                <div className="jc-tools">
                  <div className="seg-tabs" role="tablist" aria-label="Show">
                    {FILTERS.map(([key, label]) => (
                      <button key={key} type="button" role="tab" aria-selected={filter === key}
                        className={`seg-tab${filter === key ? " is-on" : ""}`} onClick={() => setFilter(key)}>
                        {label} <span className="seg-count">{counts[key]}</span>
                      </button>
                    ))}
                  </div>
                  <input className="input jc-search" type="search" placeholder="Search Jamaat or Jamiat" value={q}
                    onChange={(e) => setQ(e.target.value)} aria-label="Search Jamaat or Jamiat" />
                </div>
                {question && (
                  <div className="jc-active-filter">
                    Showing Jamaats where <b>{questionLabel}</b> is not done yet
                    <button type="button" className="mini-btn" onClick={() => setQuestion("")}>Clear</button>
                  </div>
                )}
                <div className="table-wrap">
                  {list.length ? (
                    <table className="master-table card-rows jc-table">
                      <thead>
                        <tr><th>Jamaat</th><th>Status</th><th>Answers done</th><th>Not done yet</th><th>Last saved</th><th /></tr>
                      </thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.id}>
                            <td className="cell-main">
                              <span className="jm-name">{r.name}</span>
                              <span className="jm-sub">{r.jamiat}</span>
                            </td>
                            <td data-label="Status"><span className={`pill ${STATE[r.state].tone}`}><span className={`dot tone-${STATE[r.state].tone}`} />{STATE[r.state].label}</span></td>
                            <td data-label="Answers done" className={`tnum${r.submittedAt ? "" : " m-hide"}`}>
                              {r.submittedAt ? (
                                <span className="mini-progress">
                                  <Bar value={pct(r.done, r.applicable)} label={`${r.name} answers done`} />
                                  <span>{r.done}/{r.applicable}</span>
                                </span>
                              ) : <span className="muted">—</span>}
                            </td>
                            <td data-label="Not done yet" className={`wide${r.open.length ? "" : " m-hide"}`}>
                              {r.open.length ? (
                                <span className="open-list">
                                  {r.open.map((o) => (
                                    <span key={o.key} className={`pill ${o.tone}`} title={`${o.label}: ${o.value}`}><span className={`dot tone-${o.tone}`} />{o.label}: {o.value}</span>
                                  ))}
                                </span>
                              ) : <span className="muted">{r.submittedAt ? "Nothing" : "—"}</span>}
                            </td>
                            <td data-label="Last saved" className="nowrap">{r.submittedAt ? fmtDate(r.submittedAt) : <span className="muted">Not yet</span>}</td>
                            <td className="row-actions">
                              <button type="button" className={`mini-btn${r.state === "todo" ? " primary" : ""}`} onClick={() => open(r)}>
                                {r.state === "todo" ? "Fill" : "Update"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <div className="empty-state">No Jamaats match.</div>}
                </div>
              </div>

              <aside className="panel panel-side">
                <div className="panel-head">
                  <div>
                    <h2>By question</h2>
                    <p>Answers in the {plural(submitted, "submitted form")}. Click a question to list the Jamaats where it is not done yet.</p>
                  </div>
                </div>
                <div className="side-body">
                  <div className="q-legend" aria-hidden="true">
                    <span><span className="dot tone-good" />Done</span>
                    <span><span className="dot tone-warn" />Not done yet</span>
                    <span><span className="dot tone-na" />Not applicable</span>
                  </div>
                  <ul className="q-stats">
                    {perQuestion.map((s) => {
                      const total = s.d + s.o + s.na;
                      return (
                        <li key={s.key}>
                          <button type="button" className={`q-stat${question === s.key ? " is-sel" : ""}`} disabled={!s.o}
                            onClick={() => setQuestion(question === s.key ? "" : s.key)}
                            title={s.o ? "Show these Jamaats" : "Nothing open"}>
                            <span className="q-stat-top">
                              <span className="q-stat-name">{s.label}</span>
                              <span className="q-stat-num">{s.o ? `${s.o} not done` : total ? "All done" : "No answers yet"}</span>
                            </span>
                            <span className="stack jc-stack" role="img" aria-label={`${s.label}: ${s.d} done, ${s.o} not done yet, ${s.na} not applicable`}>
                              {total > 0 && <>
                                {s.d > 0 && <span className="seg tone-good" style={{ flexGrow: s.d }} />}
                                {s.o > 0 && <span className="seg tone-warn" style={{ flexGrow: s.o }} />}
                                {s.na > 0 && <span className="seg tone-na" style={{ flexGrow: s.na }} />}
                              </>}
                            </span>
                            <span className="q-stat-sub">{s.d} done · {s.o} not done · {s.na} N/A</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </aside>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Kpi({ icon, tone, label, value, sub, children }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="eyebrow">{label}</span>
        <span className={`kpi-icon ${tone}`}>{icon}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {children}
      <div className="kpi-sub" title={typeof sub === "string" ? sub : undefined}>{sub}</div>
    </div>
  );
}

const Bar = ({ value, label }) => (
  <div className="progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${value}%` }} />
  </div>
);
