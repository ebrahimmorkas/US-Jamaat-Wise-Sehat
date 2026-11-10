import { useEffect } from "react";
import AppBar from "./components/AppBar";
import Users from "./Users";
import Masters from "./Masters";
import PortalFields from "./PortalFields";

const NAV = [
  { to: "/admin/users", label: "Users" },
  { to: "/admin/masters", label: "Masters" },
  { to: "/admin/fields", label: "Portal Fields" },
];

// Super Admin portal: users, Jamiat/Jamaat masters, portal fields (JC form questions).
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
        {page === "/admin/users" && <Users onAuthExpired={onAuthExpired} />}
        {page === "/admin/masters" && <Masters onAuthExpired={onAuthExpired} />}
        {page === "/admin/fields" && <PortalFields onAuthExpired={onAuthExpired} />}
      </main>
    </>
  );
}
