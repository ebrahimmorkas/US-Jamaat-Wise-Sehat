import Dashboard from "./Dashboard";
import Masters from "./Masters";
import JcPortal from "./JcPortal";
import LoginPage from "./components/LoginPage";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { usePath } from "./lib/router";

export default function App() {
  const path = usePath();
  const { theme, toggle } = useTheme();

  // The JC portal is open to everyone for now (no sign-in).
  if (path === "/jc-portal") return <JcPortal theme={theme} onToggleTheme={toggle} />;
  return <SignedInArea path={path} theme={theme} onToggleTheme={toggle} />;
}

// Shows the sign-in page until the user is authenticated, then the dashboard or the masters.
function SignedInArea({ path, theme, onToggleTheme }) {
  const auth = useAuth();

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
  if (path === "/masters" && auth.user.role === "admin") return <Masters key={auth.user.id} {...common} />;
  return <Dashboard key={auth.user.id} {...common} />;
}
