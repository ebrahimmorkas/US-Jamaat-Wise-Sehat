import { useEffect, useRef } from "react";
import StatusPage from "./components/StatusPage";
import { reportAccessDenied } from "./lib/api";

const ROLE_LABELS = { saheb: "Saheb", superadmin: "Super Admin", jc: "JC" };

// Shown when a signed-in user opens a page their role can't use. The attempt is logged.
// `logged` = the server already logged it (an API refusal), so don't report again.
export default function AccessDenied({ user, page, logged, onHome, onSignOut, theme, onToggleTheme }) {
  const sent = useRef("");
  useEffect(() => {
    if (logged || sent.current === page) return;
    sent.current = page;
    reportAccessDenied(page);
  }, [page, logged]);

  return (
    <StatusPage
      tone="warn"
      code="403"
      title="Access denied"
      theme={theme}
      onToggleTheme={onToggleTheme}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={onSignOut}>Sign out</button>
          <button type="button" className="btn btn-primary" onClick={onHome}>Go to my page</button>
        </>
      }
    >
      <p>You are signed in as <b>{user.email || user.username}</b> ({ROLE_LABELS[user.role] || user.role}). This page is not available for your role.</p>
      <p className="muted">This attempt has been recorded. If you need access, contact the Super Admin.</p>
    </StatusPage>
  );
}
