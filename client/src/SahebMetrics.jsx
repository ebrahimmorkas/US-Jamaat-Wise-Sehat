import AppBar from "./components/AppBar";
import JcMetricsPanel from "./components/JcMetricsPanel";
import { SAHEB_NAV } from "./Dashboard";

// Saheb › JC Metrics: every JC with the permanent work they handle (search + Jamiat filter, live).
export default function SahebMetrics({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  return (
    <>
      <AppBar nav={SAHEB_NAV} page="/jc-metrics" theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container">
        <section className="page-head">
          <div className="page-title">
            <h1>JC Metrics</h1>
            <p className="page-sub">The permanent work each JC handles besides their Jamaats (entered by the JC) and each JC's star rating (given by the Super Admin; JCs don't see it). Updates live.</p>
          </div>
        </section>
        <JcMetricsPanel heading={false} onAuthExpired={onAuthExpired} />
      </main>
    </>
  );
}
