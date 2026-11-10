import { useEffect } from "react";
import Dashboard from "./Dashboard";
import AdminPortal from "./AdminPortal";
import JcPortal from "./JcPortal";
import LoginPage from "./components/LoginPage";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { usePath } from "./lib/router";

export default function App() {
  const path = usePath();
  const { theme, toggle } = useTheme();

  // The JC portal is open to everyone for now (JC sign-in comes later).
  if (path === "/jc-portal") return <JcPortal theme={theme} onToggleTheme={toggle} />;
  return <SignedInArea path={path} theme={theme} onToggleTheme={toggle} />;
}

// Each role has its own home:  Saheb -> "/" (dashboard)   Super Admin -> "/admin/..."
const homeOf = (role) => (role === "superadmin" ? "/admin/users" : "/");
const belongsTo = (role, path) => (role === "superadmin" ? path.startsWith("/admin/") : !path.startsWith("/admin"));

function SignedInArea({ path, theme, onToggleTheme }) {
  const auth = useAuth();
  const role = auth.user && auth.user.role;

  // Keep the address bar on a page this role may open.
  useEffect(() => {
    if (role && !belongsTo(role, path)) window.history.replaceState(null, "", homeOf(role));
  }, [role, path]);

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
    return <LoginPage onSignIn={auth.signIn} message={auth.message} theme={theme} onToggleTheme={onToggleTheme} />;
  }

  const common = { user: auth.user, onSignOut: auth.signOut, onAuthExpired: auth.expire, theme, onToggleTheme };
  if (role === "superadmin") {
    return <AdminPortal key={auth.user.id} {...common} path={belongsTo(role, path) ? path : homeOf(role)} />;
  }
  if (role === "saheb") return <Dashboard key={auth.user.id} {...common} />;

  return (
    <div className="login-shell">
      <div className="login-card">
        <img className="login-logo" src="/logo.png" alt="Umoor Sehhat logo" />
        <p>This account has no page to open yet.</p>
        <button type="button" className="btn btn-primary login-btn" onClick={auth.signOut}>Sign out</button>
      </div>
    </div>
  );
}
