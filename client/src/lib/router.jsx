// Tiny path router: "/" dashboard, "/masters" masters (admin), "/jc-portal" JC form.
import { useEffect, useState } from "react";

const clean = (p) => (p.replace(/\/+$/, "") || "/").toLowerCase();

export function usePath() {
  const [path, setPath] = useState(() => clean(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(clean(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function navigate(to) {
  if (clean(window.location.pathname) === clean(to)) return;
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

/** <a> that changes page without reloading (Ctrl/Cmd-click still opens a new tab). */
export function Link({ to, onClick, ...rest }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick && onClick(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
