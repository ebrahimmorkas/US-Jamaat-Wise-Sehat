import { useEffect } from "react";
import AppBar from "./components/AppBar";
import JcUsers from "./JcUsers";
import Masters from "./Masters";
import Dropdowns from "./Dropdowns";

const NAV = [
  { to: "/admin/users", label: "JC Users" },
  { to: "/admin/masters", label: "Masters" },
  { to: "/admin/dropdowns", label: "Dropdown values" },
];

// Super Admin portal: JC users, Jamiat/Jamaat masters, dropdown values.
export default function AdminPortal({ path, user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const page = NAV.some((n) => n.to === path) ? path : NAV[0].to;

  useEffect(() => {
    const before = document.title;
    document.title = "Super Admin · Umoor Sehhat";
    return () => { document.title = before; };
  }, []);

  return (
    <>
      <AppBar title="Super Admin" subtitle="Umoor Sehhat" nav={NAV} page={page}
        theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container">
        {page === "/admin/users" && <JcUsers onAuthExpired={onAuthExpired} />}
        {page === "/admin/masters" && <Masters onAuthExpired={onAuthExpired} />}
        {page === "/admin/dropdowns" && <Dropdowns onAuthExpired={onAuthExpired} />}
      </main>
    </>
  );
}
