import { Link } from "../lib/router";
import { LogoutIcon, MoonIcon, RefreshIcon, SunIcon } from "./Icons";

const ROLE_LABELS = { saheb: "Saheb", superadmin: "Super Admin", jc: "JC" };

// Top bar. `nav` = [{ to, label }] page tabs (current one = `page`).
// The refresh block is shown only when `sync` is passed (dashboard page).
export default function AppBar({ title = "Umoor Sehhat", subtitle = "Monthly Coordination", nav, page, sync, theme, onToggleTheme, user, onSignOut }) {
  const dark = theme === "dark";
  const themeLabel = dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <header className="appbar">
      <div className="container appbar-inner">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="Umoor Sehhat logo" />
          <span className="brand-divider" aria-hidden="true" />
          <div>
            <div className="brand-name">{title}</div>
            <div className="brand-sub">{subtitle}</div>
          </div>
          {nav && nav.length > 0 && (
            <nav className="app-nav" aria-label="Pages">
              {nav.map((n) => (
                <Link key={n.to} to={n.to} className={page === n.to ? "is-current" : ""} aria-current={page === n.to ? "page" : undefined}>{n.label}</Link>
              ))}
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
                <span className="user-role">{ROLE_LABELS[user.role] || user.role}</span>
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

// live = connection state of the live updates (see lib/realtime.js).
const LIVE_TEXT = {
  live: "Live · updates as JCs save",
  connecting: "Connecting to live updates…",
  offline: "Live updates paused · reconnecting…",
  off: "Live updates off · use Refresh",
  idle: "Live updates off · use Refresh",
};

function SyncStatus({ syncedAt, loading, failed, live }) {
  let status = "Loading…";
  if (loading && syncedAt) status = "Updating…";
  else if (syncedAt) status = "Updated " + new Date(syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  else if (failed) status = "Update failed";

  const dotClass = loading ? "sync-dot busy" : failed || live === "offline" ? "sync-dot error" : live === "live" ? "sync-dot" : "sync-dot idle";

  return (
    <div className="sync-text" aria-live="polite">
      <span className="sync-line"><span className={dotClass} />{status}</span>
      <span className="sync-next">{LIVE_TEXT[live] || LIVE_TEXT.idle}</span>
    </div>
  );
}
