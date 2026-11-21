import { useCallback, useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import AdminPortal from "./AdminPortal";
import JcPortal from "./JcPortal";
import JcDashboard from "./JcDashboard";
import JcData from "./JcData";
import JcMetrics from "./JcMetrics";
import SahebMetrics from "./SahebMetrics";
import SahebStats from "./SahebStats";
import FormResponses from "./FormResponses";
import { SAHEB_NAV } from "./Dashboard";
import { JC_NAV } from "./JcDashboard";
import JcStats from "./JcStats";
import CoordinatorPortal, { COORD_HOME, isCoordPage } from "./CoordinatorPortal";
import FormFillPage from "./FormFillPage";
import ErrorPage from "./ErrorPage";
import AccessDenied from "./AccessDenied";
import LoginPage from "./components/LoginPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { ConfirmHost } from "./components/ConfirmDialog";
import ChatWidget from "./components/ChatWidget";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { navigate, usePath } from "./lib/router";
import { reportClientError } from "./lib/api";

// Everyone signs in with Google; each role has its own home:
//   Saheb -> "/" (dashboard)   Super Admin -> "/admin/..."   JC -> "/jc-portal" (their dashboard) + "/jc-portal/form"
//   Jamaat Coordinator -> "/coordinator" (Home, My forms, My responses, Notifications, Profile)
const homeOf = (role) => ({ superadmin: "/admin/users", jc: "/jc-portal/stats", jamaat_coordinator: COORD_HOME }[role] || "/"); // JC: Stats first
const isJcPage = (path) => path === "/jc-portal" || path.startsWith("/jc-portal/");
const belongsTo = (role, path) =>
  role === "superadmin" ? path.startsWith("/admin/") : role === "jc" ? isJcPage(path) : role === "jamaat_coordinator" ? isCoordPage(path)
    : !path.startsWith("/admin") && !isJcPage(path) && !path.startsWith("/coordinator");
// Pages that belong to a role. Opening one with another role shows "Access denied" (and is logged);
// any other address (e.g. "/") just takes the user to their own home.
const isRestrictedPage = (path) => path.startsWith("/admin") || isJcPage(path) || path.startsWith("/coordinator");

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
    <>
      <ErrorBoundary resetKey={path} onError={showError} fallback={<ErrorPage theme={theme} onToggleTheme={toggle} />}>
        {path === "/error" ? <ErrorPage theme={theme} onToggleTheme={toggle} />
          : /^\/f\/[A-Za-z0-9]{8,16}$/.test(path) ? <FormFillPage id={path.slice(3)} theme={theme} onToggleTheme={toggle} /> // a form: sign-in depends on the form
          : <Main path={path} theme={theme} onToggleTheme={toggle} />}
      </ErrorBoundary>
      <ConfirmHost />
    </>
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
    if (role && !denied && !belongsTo(role, path)) {
      window.history.replaceState(null, "", homeOf(role));
      window.dispatchEvent(new PopStateEvent("popstate")); // show the home page, not just change the address
    }
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
  let page;
  if (role === "superadmin") page = <AdminPortal key={auth.user.id} {...common} path={belongsTo(role, path) ? path : homeOf(role)} />;
  else if (role === "jc") {
    page = path === "/jc-portal/form" ? <JcPortal key={auth.user.id} {...common} />
      : path === "/jc-portal/data" ? <JcData key={auth.user.id} {...common} />
      : path === "/jc-portal/metrics" ? <JcMetrics key={auth.user.id} {...common} />
      : path === "/jc-portal/stats" ? <JcStats key={auth.user.id} {...common} />
      : path === "/jc-portal/responses" ? <FormResponses key={auth.user.id} {...common} nav={JC_NAV} page="/jc-portal/responses" />
      : <JcDashboard key={auth.user.id} {...common} />;
  } else if (role === "jamaat_coordinator") page = <CoordinatorPortal key={auth.user.id} {...common} path={path} />;
  else page = path === "/jc-metrics" ? <SahebMetrics key={auth.user.id} {...common} />
    : path === "/stats" ? <SahebStats key={auth.user.id} {...common} />
    : path === "/responses" ? <FormResponses key={auth.user.id} {...common} nav={SAHEB_NAV} page="/responses" />
    : <Dashboard key={auth.user.id} {...common} />;
  return (
    <>
      {page}
      {/* The assistant, on every portal except the Jamaat Coordinator's (answers limited to what this role may see). */}
      {role !== "jamaat_coordinator" && <ChatWidget key={`chat-${auth.user.id}`} user={auth.user} onAuthExpired={auth.expire} raised={path === "/jc-portal/form"} />}
    </>
  );
}
