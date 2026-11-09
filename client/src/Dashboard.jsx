import { useCallback, useEffect, useMemo, useState } from "react";
import AppBar from "./components/AppBar";
import PageHead from "./components/PageHead";
import Kpis from "./components/Kpis";
import MetricCard from "./components/MetricCard";
import SidePanel from "./components/SidePanel";
import ListDialog from "./components/ListDialog";
import Skeleton from "./components/Skeleton";
import { useDashboardData } from "./hooks/useDashboardData";
import { ALL, makeStatusHelpers, plural, scopeRows } from "./lib/helpers";
import { logEvent } from "./lib/api";

export default function Dashboard({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const { payload, error, loading, nextAt, intervalSecs, refresh } = useDashboardData({ onAuthError: onAuthExpired });

  const [jamiat, setJamiat] = useState(ALL);
  const [jamaat, setJamaat] = useState(ALL);
  const [selected, setSelected] = useState({}); // metricKey -> status picked in the card
  const [dialog, setDialog] = useState(null);   // { key, status }
  const [tip, setTip] = useState(null);         // { x, y, content }

  const config = payload && payload.config;
  const data = payload && payload.data;
  const jamiats = useMemo(() => (data ? data.jamiats : []), [data]);
  const metrics = useMemo(() => (config ? config.metrics : []), [config]);
  const helpers = useMemo(() => (config ? makeStatusHelpers(config) : null), [config]);

  // Default each card's dropdown once the config arrives.
  useEffect(() => {
    if (!config || !helpers) return;
    setSelected((prev) => {
      const next = { ...prev };
      for (const m of config.metrics) {
        const opts = helpers.statusesFor(m);
        if (!opts.includes(next[m.key])) next[m.key] = opts.includes(config.defaultStatus) ? config.defaultStatus : opts[0];
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
        tone: helpers.toneOf(dialog.status),
        list,
        scopeText: currentJamiat === ALL ? "All Jamiats" : currentJamaat === ALL ? currentJamiat : `${currentJamaat} · ${currentJamiat}`,
        showJamiat: currentJamiat === ALL,
        showJamaat: currentJamiat === ALL || currentJamaat === ALL,
        showRemarks: config.showRemarks && list.some((r) => r.remarks),
      };
    }
  }

  const failedSheets = data ? data.failedSheets : [];
  const message = error || (failedSheets.length ? `Could not load: ${failedSheets.join(", ")}. Check that these sheet names match exactly.` : "");

  return (
    <>
      <AppBar
        syncedAt={data && data.syncedAt}
        loading={loading}
        failed={!!error && !data}
        nextAt={nextAt}
        intervalSecs={intervalSecs}
        onRefresh={refresh}
        theme={theme}
        onToggleTheme={onToggleTheme}
        user={user}
        onSignOut={onSignOut}
      />

      <main className="container">
        <PageHead
          month={data && data.month}
          jamiat={currentJamiat}
          jamaat={currentJamaat}
          jamiatNames={jamiatNames}
          jamaatNames={jamaatNames}
          onJamiat={chooseJamiat}
          onJamaat={setJamaat}
        />

        {message && <div className="alert" role="status">{message}</div>}

        {!payload || !helpers ? (
          <Skeleton />
        ) : (
          <>
            <Kpis rows={rows} metrics={metrics} helpers={helpers} scopeSub={scopeSub} />
            <section className="layout">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h2>Activity status</h2>
                    <p>Choose a status in any card to count Jamaats with it. Click the number to see the list.</p>
                  </div>
                </div>
                <div className="cards" onPointerLeave={onTipHide}>
                  {metrics.map((m) => (
                    <MetricCard
                      key={m.key}
                      metric={m}
                      rows={rows}
                      helpers={helpers}
                      status={selected[m.key] || config.defaultStatus}
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
    </>
  );
}
