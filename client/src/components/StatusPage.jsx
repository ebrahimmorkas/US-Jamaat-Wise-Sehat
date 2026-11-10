import { MoonIcon, SunIcon } from "./Icons";

// Full-page message used by the Error and Access denied pages.
export default function StatusPage({ tone, code, title, children, actions, theme, onToggleTheme }) {
  const dark = theme === "dark";
  return (
    <div className="login-shell">
      {onToggleTheme && (
        <button type="button" className={`icon-toggle login-theme${dark ? " is-dark" : ""}`} onClick={onToggleTheme}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
          <span className="sun"><SunIcon /></span>
          <span className="moon"><MoonIcon /></span>
        </button>
      )}
      <main className="login-card status-card" role="alert">
        <img className="login-logo status-logo" src="/logo.png" alt="Umoor Sehhat logo" />
        <div className={`status-code tone-text-${tone}`}>{code}</div>
        <h1 className="status-title">{title}</h1>
        <div className="status-body">{children}</div>
        <div className="status-actions">{actions}</div>
      </main>
    </div>
  );
}
