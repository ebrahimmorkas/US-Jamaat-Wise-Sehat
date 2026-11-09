import { useCallback, useEffect, useState } from "react";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const current = () => document.documentElement.dataset.theme || (media().matches ? "dark" : "light");

// Light/dark toggle. Follows the device until the viewer picks one; the choice is
// remembered in this browser only.
export function useTheme() {
  const [theme, setTheme] = useState(current);

  useEffect(() => {
    const mq = media();
    const onChange = () => setTheme(current());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage blocked */ }
    setTheme(next);
  }, []);

  return { theme, toggle };
}
