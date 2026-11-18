import { useEffect } from "react";
import AppBar from "./components/AppBar";
import Users from "./Users";
import Masters from "./Masters";
import PortalFields from "./PortalFields";
import Logs from "./Logs";
import DataAdmin from "./DataAdmin";
import JcMetricsPanel from "./components/JcMetricsPanel";
import StatsView from "./components/StatsView";
import { BriefcaseIcon, ImageIcon, FormIcon, HistoryIcon, ListIcon, TableIcon, UsersIcon } from "./components/Icons";

const NAV = [
  { to: "/admin/users", label: "Users", icon: <UsersIcon /> },
  { to: "/admin/masters", label: "Masters", icon: <ListIcon /> },
  { to: "/admin/fields", label: "Portal Fields", icon: <FormIcon /> },
  { to: "/admin/data", label: "Data", icon: <TableIcon /> },
  { to: "/admin/metrics", label: "Metrics & Ratings", icon: <BriefcaseIcon /> },
  { to: "/admin/stats", label: "Stats", icon: <ImageIcon /> },
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
        {page === "/admin/stats" && (
          <>
            <section className="page-head"><div className="page-title"><h1>Stats</h1>
              <p className="page-sub">Upload an image that every portal shows (it is the first tab on the JC Portal). Each new upload keeps the earlier images in the history with their dates.</p></div></section>
            <StatsView admin onAuthExpired={onAuthExpired} />
          </>
        )}
        {page === "/admin/metrics" && (
          <>
            <section className="page-head"><div className="page-title"><h1>Metrics &amp; Star Ratings</h1>
              <p className="page-sub">The permanent work each JC handles (entered by the JC) and your star rating of each JC. Click a star to rate; click it again to clear. Only you and the Saheb see the ratings — JCs never do.</p></div></section>
            <JcMetricsPanel admin heading={false} onAuthExpired={onAuthExpired} />
          </>
        )}
        {page === "/admin/logs" && <Logs onAuthExpired={onAuthExpired} />}
      </main>
    </>
  );
}
