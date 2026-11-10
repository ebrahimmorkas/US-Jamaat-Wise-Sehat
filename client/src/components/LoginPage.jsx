import { useEffect, useRef, useState } from "react";
import { authConfig, isServerStarting } from "../lib/api";
import { MoonIcon, SunIcon } from "./Icons";

// Loads Google's "Sign in with Google" script once.
let gsiPromise = null;
function loadGoogleScript() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gsiPromise = null; reject(new Error("Could not load Google sign-in. Check your internet connection.")); };
      document.head.appendChild(s);
    });
  }
  return gsiPromise;
}

// Sign-in page: Google only. Only Gmail addresses added by the Super Admin can get in.
export default function LoginPage({ onGoogle, onDev, message, theme, onToggleTheme }) {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [devEmail, setDevEmail] = useState("");
  const buttonBox = useRef(null);
  const onGoogleRef = useRef(onGoogle);
  onGoogleRef.current = onGoogle;
  const dark = theme === "dark";

  // Sign-in settings from the server (retry while it wakes up).
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const load = () =>
      authConfig()
        .then((c) => alive && setCfg(c))
        .catch((err) => {
          if (!alive) return;
          if (isServerStarting(err) && tries++ < 24) { setError("Connecting to the server…"); setTimeout(load, 5000); }
          else setError(err.message);
        });
    load();
    return () => { alive = false; };
  }, []);

  // Draw Google's button (again when the theme changes).
  useEffect(() => {
    if (!cfg || !cfg.googleClientId) return;
    let alive = true;
    loadGoogleScript()
      .then(() => {
        if (!alive || !buttonBox.current) return;
        setError((e) => (e === "Connecting to the server…" ? "" : e));
        const gid = window.google.accounts.id;
        gid.initialize({
          client_id: cfg.googleClientId,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: async ({ credential }) => {
            setBusy(true);
            setError("");
            try {
              await onGoogleRef.current(credential);
            } catch (err) {
              setError(err.message || "Could not sign in.");
            } finally {
              setBusy(false);
            }
          },
        });
        buttonBox.current.innerHTML = "";
        gid.renderButton(buttonBox.current, {
          type: "standard", theme: dark ? "filled_black" : "outline", size: "large",
          text: "signin_with", shape: "pill", logo_alignment: "left", width: 300,
        });
      })
      .catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, [cfg, dark]);

  const devSubmit = async (e) => {
    e.preventDefault();
    if (!devEmail.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onDev(devEmail.trim());
    } catch (err) {
      setError(err.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  const shown = error || message;
  const notSetUp = cfg && !cfg.googleClientId;

  return (
    <div className="login-shell">
      <button type="button" className={`icon-toggle login-theme${dark ? " is-dark" : ""}`} onClick={onToggleTheme}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
        <span className="sun"><SunIcon /></span>
        <span className="moon"><MoonIcon /></span>
      </button>

      <main className="login-card">
        <img className="login-logo" src="/logo.png" alt="Umoor Sehhat logo" />

        {shown && <div className={`login-msg${error ? " is-error" : ""}`} role={error ? "alert" : "status"}>{shown}</div>}

        <p className="login-hint">Sign in with the Google account registered by the Super Admin.</p>

        {!cfg && !error && <div className="google-slot muted">Loading…</div>}
        {cfg && cfg.googleClientId && (
          <div className={`google-slot${busy ? " is-busy" : ""}`}>
            <div ref={buttonBox} />
            {busy && <div className="muted">Signing in…</div>}
          </div>
        )}
        {notSetUp && <div className="login-msg">Google sign-in is not set up yet (the server needs a Google Client ID).</div>}

        {cfg && cfg.devLogin && (
          <form className="dev-login" onSubmit={devSubmit}>
            <div className="eyebrow">Local testing only</div>
            <div className="dev-row">
              <input className="input" type="email" placeholder="registered@gmail.com" value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)} aria-label="Gmail to sign in as" disabled={busy} />
              <button type="submit" className="btn btn-primary" disabled={busy}>Sign in as</button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
