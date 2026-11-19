import AppBar from "./components/AppBar";
import StatsView from "./components/StatsView";
import { JC_NAV } from "./JcDashboard";

// JC Portal › Stats (the first tab): the image the Super Admin shared, with its date and history.
export default function JcStats({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  return (
    <div className="portal">
      <AppBar title="JC Portal" subtitle="Monthly Jamaat follow-up" nav={JC_NAV} page="/jc-portal/stats"
        theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container">
        <section className="page-head"><div className="page-title"><h1>Stats</h1>
          <p className="page-sub">Shared by the Super Admin for each Jamiat. Choose a Jamiat to see its latest image; earlier ones are in the history below.</p></div></section>
        <StatsView topic="portal" onAuthExpired={onAuthExpired} />
      </main>
    </div>
  );
}
