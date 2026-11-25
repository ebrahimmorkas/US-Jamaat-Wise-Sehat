import { useEffect } from "react";
import AppBar from "./components/AppBar";
import Users from "./Users";
import Masters from "./Masters";
import PortalFields from "./PortalFields";
import Logs from "./Logs";
import FormsAdmin from "./FormsAdmin";
import FormResponses from "./FormResponses";
import Emails from "./Emails";
import Reports from "./Reports";
import DataAdmin from "./DataAdmin";
import StorageSettings from "./StorageSettings";
import JcMetricsPanel from "./components/JcMetricsPanel";
import StatsView from "./components/StatsView";
import { BriefcaseIcon, GearIcon, ImageIcon, ReportIcon, SendIcon, FormIcon, HistoryIcon, ListIcon, PencilIcon, TableIcon, UsersIcon } from "./components/Icons";

const NAV = [
  { to: "/admin/users", label: "Users", icon: <UsersIcon /> },
  { to: "/admin/masters", label: "Masters", icon: <ListIcon /> },
  { to: "/admin/fields", label: "Portal Fields", icon: <FormIcon /> },
  { to: "/admin/forms", label: "Forms", icon: <PencilIcon /> },
  { to: "/admin/responses", label: "Responses", icon: <ListIcon /> },
  { to: "/admin/emails", label: "Send email", icon: <SendIcon /> },
  { to: "/admin/reports", label: "Reports", icon: <ReportIcon /> },
  { to: "/admin/data", label: "Data", icon: <TableIcon /> },
  { to: "/admin/metrics", label: "Metrics & Ratings", icon: <BriefcaseIcon /> },
  { to: "/admin/stats", label: "Stats", icon: <ImageIcon /> },
  { to: "/admin/logs", label: "Logs", icon: <HistoryIcon /> },
  { to: "/admin/settings", label: "Settings", icon: <GearIcon /> },
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
        {page === "/admin/forms" && <FormsAdmin onAuthExpired={onAuthExpired} />}
        {page === "/admin/responses" && <FormResponses embedded onAuthExpired={onAuthExpired} />}
        {page === "/admin/emails" && <Emails embedded user={user} onAuthExpired={onAuthExpired} />}
        {page === "/admin/reports" && <Reports embedded user={user} onAuthExpired={onAuthExpired} />}
        {page === "/admin/data" && <DataAdmin onAuthExpired={onAuthExpired} />}
        {page === "/admin/stats" && (
          <>
            <section className="page-head"><div className="page-title"><h1>Stats</h1>
              <p className="page-sub">Images per Jamiat. Choose a Jamiat, then upload its image: that Jamiat's JCs see it (first tab of the JC Portal), and so do the Saheb and you. Each new upload keeps the Jamiat's earlier images in its history with their dates.</p></div></section>
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
        {page === "/admin/settings" && <StorageSettings onAuthExpired={onAuthExpired} />}
      </main>
    </>
  );
}
