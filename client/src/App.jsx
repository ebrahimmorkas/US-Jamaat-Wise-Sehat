import { useEffect } from "react";
import Dashboard from "./Dashboard";
import AdminPortal from "./AdminPortal";
import JcPortal from "./JcPortal";
import LoginPage from "./components/LoginPage";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { usePath } from "./lib/router";

// Everyone signs in with Google; each role has its own home:
//   Saheb -> "/" (dashboard)   Super Admin -> "/admin/..."   JC -> "/jc-portal"
const homeOf = (role) => ({ superadmin: "/admin/users", jc: "/jc-portal" }[role] || "/");
const belongsTo = (role, path) =>
  role === "superadmin" ? path.startsWith("/admin/") : role === "jc" ? path === "/jc-portal" : !path.startsWith("/admin") && path !== "/jc-portal";

export default function App() {
  const path = usePath();
  const { theme, toggle } = useTheme();
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
    return <LoginPage onGoogle={auth.signInGoogle} onDev={auth.signInDev} message={auth.message} theme={theme} onToggleTheme={toggle} />;
  }

  const common = { user: auth.user, onSignOut: auth.signOut, onAuthExpired: auth.expire, theme, onToggleTheme: toggle };
  if (role === "superadmin") return <AdminPortal key={auth.user.id} {...common} path={belongsTo(role, path) ? path : homeOf(role)} />;
  if (role === "jc") return <JcPortal key={auth.user.id} {...common} />;
  return <Dashboard key={auth.user.id} {...common} />;
}
