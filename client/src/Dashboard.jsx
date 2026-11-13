import { useCallback, useEffect, useMemo, useState } from "react";
import AppBar from "./components/AppBar";
import PageHead from "./components/PageHead";
import Kpis from "./components/Kpis";
import MetricCard from "./components/MetricCard";
import SidePanel from "./components/SidePanel";
import ListDialog from "./components/ListDialog";
import CommentsDialog from "./components/CommentsDialog";
import { CommentIcon } from "./components/Icons";
import Skeleton from "./components/Skeleton";
import { useDashboardData } from "./hooks/useDashboardData";
import { useRealtimeStatus } from "./hooks/useRealtime";
import Notice from "./components/Notice";
import { ALL, NOT_FILLED, makeStatusHelpers, plural, scopeRows } from "./lib/helpers";
import { dashboardComments, logEvent } from "./lib/api";

export default function Dashboard({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const [month, setMonth] = useState(""); // "" = current month (chosen by the server)
  const { payload, error, loading, refresh } = useDashboardData({ month, onAuthError: onAuthExpired });
  const live = useRealtimeStatus();

  const [jamiat, setJamiat] = useState(ALL);
  const [jamaat, setJamaat] = useState(ALL);
  const [selected, setSelected] = useState({}); // metricKey -> status picked in the card
  const [dialog, setDialog] = useState(null);   // { key, status }
  const [tip, setTip] = useState(null);         // { x, y, content }
  const [hiddenError, setHiddenError] = useState(""); // error message the user closed
  const [comments, setComments] = useState(null);     // comments popup request
  const closeComments = useCallback(() => setComments(null), []);

  const config = payload && payload.config;
  const data = payload && payload.data;
  const jamiats = useMemo(() => (data ? data.jamiats : []), [data]);
  const metrics = useMemo(() => (config ? config.metrics : []), [config]);
  const helpers = useMemo(() => (config ? makeStatusHelpers() : null), [config]);

  // Default each card's dropdown once the config arrives.
  useEffect(() => {
    if (!config || !helpers) return;
    setSelected((prev) => {
      const next = { ...prev };
      for (const m of config.metrics) {
        const opts = [...helpers.statusesFor(m), NOT_FILLED];
        if (!opts.includes(next[m.key])) next[m.key] = m.defaultStatus || opts[0];
      }
      return next;
    });
  }, [config, helpers]);

  // Keep the selection valid after a refresh (e.g. a Jamiat/Jamaat was renamed).
  const jamiatNames = jamiats.map((j) => j.name);
  const currentJamiat = jamiat !== ALL && !jamiatNames.includes(jamiat) ? ALL : jamiat;
  const jamaatNames = currentJamiat === ALL ? [] : (jamiats.find((j) => j.name === currentJamiat)?.jamaats || []).map((x) => x.name);
  const currentJamaat = currentJamiat === ALL || !jamaatNames.includes(jamaat) ? ALL : jamaat;

  const rows = useMemo(() => scopeRows(jamiats, currentJamiat, currentJamaat), [jamiats, currentJamiat, currentJamaat]);

  const chooseJamiat = useCallback((name) => { setJamiat(name); setJamaat(ALL); }, []);
  const onTip = useCallback((e, content) => setTip({ x: e.clientX, y: e.clientY, content }), []);
  const onTipHide = useCallback(() => setTip(null), []);

  const scopeSub =
    currentJamiat === ALL ? `across ${plural(jamiats.length, "Jamiat")}` : currentJamaat === ALL ? `in ${currentJamiat}` : currentJamaat;

  // Popup contents
  let view = null;
  if (dialog && helpers) {
    const metric = metrics.find((m) => m.key === dialog.key);
    if (metric) {
      const list = rows.filter((r) => helpers.matchesStatus(r.values[metric.key], dialog.status));
      view = {
        metric,
        status: dialog.status,
        tone: helpers.toneOf(dialog.status, metric),
        list,
        scopeText: currentJamiat === ALL ? "All Jamiats" : currentJamaat === ALL ? currentJamiat : `${currentJamaat} · ${currentJamiat}`,
        showJamiat: currentJamiat === ALL,
        showJamaat: currentJamiat === ALL || currentJamaat === ALL,
        showRemarks: config.showRemarks && list.some((r) => r.remarks),
      };
    }
  }

  const submittedInScope = rows.filter((r) => r.submittedAt).length;

  // Comments: only counts come with the dashboard; the text is loaded when the popup opens.
  const commentCount = (key) => rows.reduce((n, r) => n + (r.commented || []).filter((k) => !key || k === key).length, 0);
  const openComments = (metric) => {
    const viewMonth = data.month, sj = currentJamiat, sm = currentJamaat;
    setComments({
      load: () => dashboardComments(viewMonth),
      title: metric ? metric.label : "Comments",
      question: metric ? metric.key : "",
      scopeText: sj === ALL ? "All Jamiats" : sm === ALL ? sj : `${sm} · ${sj}`,
      inScope: (c) => (sj === ALL || c.jamiat === sj) && (sj === ALL || sm === ALL || c.jamaat === sm),
    });
  };

  return (
    <>
      <AppBar
        page="dashboard"
        sync={{ syncedAt: data && data.loadedAt, loading, failed: !!error && !data, live, onRefresh: refresh }}
        theme={theme}
        onToggleTheme={onToggleTheme}
        user={user}
        onSignOut={onSignOut}
      />

      <main className="container">
        <PageHead
          month={data ? data.month : month}
          months={(data && data.months) || []}
          onMonth={setMonth}
          jamiat={currentJamiat}
          jamaat={currentJamaat}
          jamiatNames={jamiatNames}
          jamaatNames={jamaatNames}
          onJamiat={chooseJamiat}
          onJamaat={setJamaat}
        />

        {error && error !== hiddenError && <Notice type="error" text={error} onClose={() => setHiddenError(error)} />}

        {!payload || !helpers ? (
          <Skeleton />
        ) : (
          <>
            <Kpis rows={rows} metrics={metrics} helpers={helpers} scopeSub={scopeSub}
              submitted={submittedInScope} monthLabel={data.monthLabel} />
            <section className="layout">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Activity status</h2>
                    <p>Choose a status in any card to count Jamaats with it. Click the number to see the list.</p>
                  </div>
                  <button type="button" className="btn btn-ghost cmt-btn" onClick={() => openComments(null)}
                    title="Read the comments JCs added under the questions">
                    <CommentIcon /> <span>Comments</span> <span className="cmt-count">{commentCount()}</span>
                  </button>
                </div>
                <div className="cards" onPointerLeave={onTipHide}>
                  {metrics.map((m) => (
                    <MetricCard
                      key={m.key}
                      metric={m}
                      rows={rows}
                      helpers={helpers}
                      status={selected[m.key] || m.defaultStatus}
                      onStatus={(s) => setSelected((prev) => ({ ...prev, [m.key]: s }))}
                      onOpen={(s) => {
                        setDialog({ key: m.key, status: s });
                        logEvent("list_viewed", {
                          metric: m.label,
                          status: s,
                          jamiat: currentJamiat,
                          jamaat: currentJamaat,
                          count: rows.filter((r) => helpers.matchesStatus(r.values[m.key], s)).length,
                        });
                      }}
                      onTip={onTip}
                      onTipHide={onTipHide}
                      comments={commentCount(m.key)}
                      onComments={() => openComments(m)}
                    />
                  ))}
                </div>
              </div>
              <SidePanel
                jamiats={jamiats}
                rows={rows}
                jamiat={currentJamiat}
                jamaat={currentJamaat}
                metrics={metrics}
                helpers={helpers}
                onJamiat={chooseJamiat}
                onJamaat={setJamaat}
              />
            </section>
          </>
        )}
      </main>

      {tip && (
        <div className="tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>
      )}
      <ListDialog view={view} onClose={() => setDialog(null)} />
      <CommentsDialog request={comments} onClose={closeComments} onAuthExpired={onAuthExpired} />
    </>
  );
}
