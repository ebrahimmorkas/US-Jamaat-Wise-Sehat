import { formatDuration } from "../lib/helpers";
import { useNow } from "../hooks/useNow";
import { Link } from "../lib/router";
import { LogoutIcon, MoonIcon, RefreshIcon, SunIcon } from "./Icons";

// Top bar. The refresh block is shown only when `sync` is passed (dashboard page).
export default function AppBar({ page, sync, theme, onToggleTheme, user, onSignOut }) {
  const dark = theme === "dark";
  const themeLabel = dark ? "Switch to light mode" : "Switch to dark mode";
  const isAdmin = user && user.role === "admin";

  return (
    <header className="appbar">
      <div className="container appbar-inner">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Umoor Sehhat logo" />
          <span className="brand-divider" aria-hidden="true" />
          <div>
            <div className="brand-name">Umoor Sehhat</div>
            <div className="brand-sub">Monthly Coordination</div>
          </div>
          {isAdmin && (
            <nav className="app-nav" aria-label="Pages">
              <Link to="/" className={page === "dashboard" ? "is-current" : ""} aria-current={page === "dashboard" ? "page" : undefined}>Dashboard</Link>
              <Link to="/masters" className={page === "masters" ? "is-current" : ""} aria-current={page === "masters" ? "page" : undefined}>Masters</Link>
            </nav>
          )}
        </div>

        <div className="sync">
          {sync && <SyncStatus {...sync} />}
          <button type="button" className={`icon-toggle${dark ? " is-dark" : ""}`} onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
            <span className="sun"><SunIcon /></span>
            <span className="moon"><MoonIcon /></span>
          </button>
          {sync && (
            <button type="button" className={`btn btn-primary${sync.loading ? " loading" : ""}`} onClick={sync.onRefresh} disabled={sync.loading}>
              <RefreshIcon />
              <span>Refresh</span>
            </button>
          )}
          {user && (
            <div className="user-menu">
              <span className="avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
              <span className="user-text">
                <span className="user-name">{user.username}</span>
                <span className="user-role">{user.role}</span>
              </span>
              <button type="button" className="icon-toggle" onClick={onSignOut} aria-label="Sign out" title="Sign out">
                <LogoutIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function SyncStatus({ syncedAt, loading, failed, nextAt, intervalSecs }) {
  const now = useNow();
  let status = "Loading…";
  if (loading && syncedAt) status = "Refreshing…";
  else if (syncedAt) status = "Updated " + new Date(syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  else if (failed) status = "Update failed";

  let next = "Auto-refresh off";
  if (intervalSecs) {
    const every = intervalSecs % 60 === 0 ? `${intervalSecs / 60} min` : formatDuration(intervalSecs);
    const left = nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : intervalSecs;
    next = loading ? `Auto-refresh every ${every}` : `Auto-refresh every ${every} · next in ${formatDuration(left)}`;
  }
  const dotClass = loading ? "sync-dot busy" : failed ? "sync-dot error" : "sync-dot";

  return (
    <div className="sync-text">
      <span className="sync-line"><span className={dotClass} />{status}</span>
      <span className="sync-next">{next}</span>
    </div>
  );
}
