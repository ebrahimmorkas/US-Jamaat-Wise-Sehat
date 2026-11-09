import Dashboard from "./Dashboard";
import LoginPage from "./components/LoginPage";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";

// Shows the sign-in page until the user is authenticated, then the dashboard.
export default function App() {
  const auth = useAuth();
  const { theme, toggle } = useTheme();

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
    return <LoginPage onSignIn={auth.signIn} message={auth.message} theme={theme} onToggleTheme={toggle} />;
  }

  return (
    <Dashboard
      key={auth.user.id}
      user={auth.user}
      onSignOut={auth.signOut}
      onAuthExpired={auth.expire}
      theme={theme}
      onToggleTheme={toggle}
    />
  );
}
