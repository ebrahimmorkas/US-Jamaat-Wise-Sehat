import { useCallback, useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import AdminPortal from "./AdminPortal";
import JcPortal from "./JcPortal";
import JcDashboard from "./JcDashboard";
import ErrorPage from "./ErrorPage";
import AccessDenied from "./AccessDenied";
import LoginPage from "./components/LoginPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { navigate, usePath } from "./lib/router";
import { reportClientError } from "./lib/api";

// Everyone signs in with Google; each role has its own home:
//   Saheb -> "/" (dashboard)   Super Admin -> "/admin/..."   JC -> "/jc-portal" (their dashboard) + "/jc-portal/form"
const homeOf = (role) => ({ superadmin: "/admin/users", jc: "/jc-portal" }[role] || "/");
const isJcPage = (path) => path === "/jc-portal" || path.startsWith("/jc-portal/");
const belongsTo = (role, path) =>
  role === "superadmin" ? path.startsWith("/admin/") : role === "jc" ? isJcPage(path) : !path.startsWith("/admin") && !isJcPage(path);
// Pages that belong to a role. Opening one with another role shows "Access denied" (and is logged);
// any other address (e.g. "/") just takes the user to their own home.
const isRestrictedPage = (path) => path.startsWith("/admin") || isJcPage(path);

// Errors we don't control (browser extensions, Google's script) must not take the user to the Error page.
const ourError = (e) => {
  const file = (e && e.filename) || "";
  const msg = String((e && e.message) || "");
  if (file && !file.startsWith(window.location.origin)) return false;
  if (/ResizeObserver loop|Script error\.?$/i.test(msg)) return false;
  return true;
};

export default function App() {
  const path = usePath();
  const { theme, toggle } = useTheme();
  const showError = useCallback((ref) => navigate(`/error${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`), []);

  // Server errors (from API calls) and uncaught errors -> Error page.
  useEffect(() => {
    const onServerError = (e) => showError(e.detail && e.detail.ref);
    const onWindowError = (e) => {
      if (!ourError(e)) return;
      reportClientError({ kind: "uncaught", message: e.message, stack: e.error && e.error.stack }).then(showError);
    };
    const onRejection = (e) => {
      const r = e.reason;
      if (r && r.name === "ApiError") return; // API failures are shown where they happen
      reportClientError({ kind: "unhandled-promise", message: String((r && r.message) || r), stack: r && r.stack }).then(showError);
    };
    window.addEventListener("app:error", onServerError);
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("app:error", onServerError);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [showError]);

  return (
    <ErrorBoundary resetKey={path} onError={showError} fallback={<ErrorPage theme={theme} onToggleTheme={toggle} />}>
      {path === "/error" ? <ErrorPage theme={theme} onToggleTheme={toggle} /> : <Main path={path} theme={theme} onToggleTheme={toggle} />}
    </ErrorBoundary>
  );
}

function Main({ path, theme, onToggleTheme }) {
  const auth = useAuth();
  const role = auth.user && auth.user.role;
  const [deniedByServer, setDeniedByServer] = useState(""); // page where an API call was refused

  // An API call was refused for this role (the server logged it) -> Access denied.
  useEffect(() => {
    const onDenied = () => setDeniedByServer(window.location.pathname);
    window.addEventListener("app:denied", onDenied);
    return () => window.removeEventListener("app:denied", onDenied);
  }, []);

  const denied = !!role && ((isRestrictedPage(path) && !belongsTo(role, path)) || deniedByServer === path);

  // Any other address that isn't this role's -> their own home (no message).
  useEffect(() => {
    if (role && !denied && !belongsTo(role, path)) window.history.replaceState(null, "", homeOf(role));
  }, [role, path, denied]);

  if (auth.status === "checking") {
    return (
      <div className="login-shell">
        <div className="splash">
          <img className="login-logo" src="/logo.png" alt="Umoor Sehhat logo" />
          <div className="splash-text">{auth.message || "Loading…"}</div>
        </div>
      </div>
    );
  }

  if (auth.status === "anon") {
    return <LoginPage onGoogle={auth.signInGoogle} onDev={auth.signInDev} message={auth.message} theme={theme} onToggleTheme={onToggleTheme} />;
  }

  if (denied) {
    return (
      <AccessDenied user={auth.user} page={path} logged={deniedByServer === path} theme={theme} onToggleTheme={onToggleTheme}
        onSignOut={auth.signOut} onHome={() => { setDeniedByServer(""); navigate(homeOf(role)); }} />
    );
  }

  const common = { user: auth.user, onSignOut: auth.signOut, onAuthExpired: auth.expire, theme, onToggleTheme };
  if (role === "superadmin") return <AdminPortal key={auth.user.id} {...common} path={belongsTo(role, path) ? path : homeOf(role)} />;
  if (role === "jc") {
    return path === "/jc-portal/form"
      ? <JcPortal key={auth.user.id} {...common} />
      : <JcDashboard key={auth.user.id} {...common} />;
  }
  return <Dashboard key={auth.user.id} {...common} />;
}
