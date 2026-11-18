import AppBar from "./components/AppBar";
import StatsView from "./components/StatsView";
import { SAHEB_NAV } from "./Dashboard";

// Saheb › Stats: the image the Super Admin shared, with its date and history.
export default function SahebStats({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  return (
    <>
      <AppBar nav={SAHEB_NAV} page="/stats" theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container">
        <section className="page-head"><div className="page-title"><h1>Stats</h1>
          <p className="page-sub">Shared by the Super Admin. The latest image is shown first; earlier ones are in the history below.</p></div></section>
        <StatsView topic="dashboard" onAuthExpired={onAuthExpired} />
      </main>
    </>
  );
}
