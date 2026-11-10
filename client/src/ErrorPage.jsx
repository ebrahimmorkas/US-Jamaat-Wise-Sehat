import StatusPage from "./components/StatusPage";

// Shown whenever something goes wrong (website crash or server error).
// The error is already saved in the error log; `ref` lets the Super Admin find it.
export default function ErrorPage({ errorRef, theme, onToggleTheme }) {
  const ref = errorRef || new URLSearchParams(window.location.search).get("ref") || "";
  return (
    <StatusPage
      tone="bad"
      code="Error"
      title="Something went wrong"
      theme={theme}
      onToggleTheme={onToggleTheme}
      actions={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => window.history.back()}>Go back</button>
          {/* full reload: starts the app fresh */}
          <button type="button" className="btn btn-primary" onClick={() => window.location.assign("/")}>Go to home page</button>
        </>
      }
    >
      <p>Sorry, the page could not finish what it was doing. The problem has been recorded for the administrator.</p>
      {ref && <p className="status-ref">Reference: <b>{ref}</b></p>}
      <p className="muted">If it keeps happening, share the reference with the Super Admin.</p>
    </StatusPage>
  );
}
