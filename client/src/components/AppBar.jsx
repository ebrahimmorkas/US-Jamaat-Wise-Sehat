import { formatDuration } from "../lib/helpers";
import { useNow } from "../hooks/useNow";
import { LogoutIcon, MoonIcon, RefreshIcon, SunIcon } from "./Icons";

export default function AppBar({ syncedAt, loading, failed, nextAt, intervalSecs, onRefresh, theme, onToggleTheme, user, onSignOut }) {
  const now = useNow();
  const dark = theme === "dark";

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
  const themeLabel = dark ? "Switch to light mode" : "Switch to dark mode";

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
        </div>

        <div className="sync">
          <div className="sync-text">
            <span className="sync-line"><span className={dotClass} />{status}</span>
            <span className="sync-next">{next}</span>
          </div>
          <button type="button" className={`icon-toggle${dark ? " is-dark" : ""}`} onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel}>
            <span className="sun"><SunIcon /></span>
            <span className="moon"><MoonIcon /></span>
          </button>
          <button type="button" className={`btn btn-primary${loading ? " loading" : ""}`} onClick={onRefresh} disabled={loading}>
            <RefreshIcon />
            <span>Refresh</span>
          </button>
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
