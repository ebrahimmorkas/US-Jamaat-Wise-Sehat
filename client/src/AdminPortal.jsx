import { useEffect } from "react";
import AppBar from "./components/AppBar";
import Users from "./Users";
import Masters from "./Masters";
import PortalFields from "./PortalFields";
import Logs from "./Logs";
import DataAdmin from "./DataAdmin";
import JcMetricsPanel from "./components/JcMetricsPanel";
import { BriefcaseIcon, FormIcon, HistoryIcon, ListIcon, TableIcon, UsersIcon } from "./components/Icons";

const NAV = [
  { to: "/admin/users", label: "Users", icon: <UsersIcon /> },
  { to: "/admin/masters", label: "Masters", icon: <ListIcon /> },
  { to: "/admin/fields", label: "Portal Fields", icon: <FormIcon /> },
  { to: "/admin/data", label: "Data", icon: <TableIcon /> },
  { to: "/admin/metrics", label: "Metrics", icon: <BriefcaseIcon /> },
  { to: "/admin/logs", label: "Logs", icon: <HistoryIcon /> },
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
        {page === "/admin/data" && <DataAdmin onAuthExpired={onAuthExpired} />}
        {page === "/admin/metrics" && (
          <>
            <section className="page-head"><div className="page-title"><h1>Metrics</h1>
              <p className="page-sub">The permanent work each JC handles besides their Jamaats, as entered by the JC on the JC Portal.</p></div></section>
            <JcMetricsPanel admin heading={false} onAuthExpired={onAuthExpired} />
          </>
        )}
        {page === "/admin/logs" && <Logs onAuthExpired={onAuthExpired} />}
      </main>
    </>
  );
}
