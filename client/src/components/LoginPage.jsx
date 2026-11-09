import { useState } from "react";
import { EyeIcon, EyeOffIcon, MoonIcon, SunIcon } from "./Icons";

export default function LoginPage({ onSignIn, message, theme, onToggleTheme }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dark = theme === "dark";

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSignIn(username.trim(), password);
    } catch (err) {
      setError(err.message || "Could not sign in.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <button type="button" className={`icon-toggle login-theme${dark ? " is-dark" : ""}`} onClick={onToggleTheme}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
        <span className="sun"><SunIcon /></span>
        <span className="moon"><MoonIcon /></span>
      </button>

      <main className="login-card">
        <img className="login-logo" src="/logo.png" alt="Umoor Sehhat logo" />

        {(error || message) && (
          <div className={`login-msg${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{error || message}</div>
        )}

        <form onSubmit={submit} noValidate>
          <label className="login-field">
            <span>Username</span>
            <input type="text" autoComplete="username" autoCapitalize="none" spellCheck="false" autoFocus
              value={username} onChange={(e) => setUsername(e.target.value)} disabled={busy} />
          </label>
          <label className="login-field">
            <span>Password</span>
            <div className="pw-wrap">
              <input type={show ? "text" : "password"} autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
              <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"} title={show ? "Hide password" : "Show password"}>
                {show ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
          <button type="submit" className="btn btn-primary login-btn" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
