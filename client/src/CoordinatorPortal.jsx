import { useCallback, useEffect, useMemo, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { fmtWhen, myZone } from "./components/FormView";
import { BellIcon, CheckIcon, ClockIcon, EyeIcon, FormIcon, HomeIcon, ListIcon, LockIcon, PencilIcon, UserIcon, WarnIcon } from "./components/Icons";
import MyForms, { FormCard, closingSoon, isPending, timeLeft, useMyForms } from "./MyForms";
import { ResponseView } from "./FormResponses";
import { AuthError, coordMarkRead, coordNotifications, coordProfile, coordResponses, coordUnread, isServerStarting } from "./lib/api";
import { Link } from "./lib/router";
import { lower, plural } from "./lib/helpers";

// The Jamaat Coordinator portal: Home, My forms, My responses, Notifications, Profile. Only their own data.
export const COORD_HOME = "/coordinator";
const PAGES = {
  "/coordinator": "Home", "/coordinator/forms": "My forms", "/coordinator/responses": "My responses",
  "/coordinator/notifications": "Notifications", "/coordinator/profile": "Profile",
};
export const isCoordPage = (path) => !!PAGES[path];

/** Load something once (retries while the server wakes up). */
function useLoad(fn, onAuthExpired) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("Loading…");
  const load = useCallback(async (tries = 0) => {
    try { setData(await fn()); }
    catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) { setMsg("Connecting to the server…"); setTimeout(() => load(tries + 1), 5000); }
      else setMsg(err.message);
    }
  }, [fn, onAuthExpired]);
  useEffect(() => { load(); }, [load]);
  return { data, setData, msg, reload: load };
}

export default function CoordinatorPortal({ path, user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const page = isCoordPage(path) ? path : COORD_HOME;
  const [unread, setUnread] = useState(0);

  // Unread count for the badge: now, every minute, and when the tab is shown again.
  useEffect(() => {
    let alive = true;
    const check = () => coordUnread().then((r) => alive && setUnread(r.unread)).catch(() => {});
    check();
    const t = setInterval(check, 60000);
    const onShow = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [page]);
  useEffect(() => { const b = document.title; document.title = `${PAGES[page]} · Umoor Sehhat`; return () => { document.title = b; }; }, [page]);

  const nav = [
    { to: "/coordinator", label: "Home", icon: <HomeIcon /> },
    { to: "/coordinator/forms", label: "My forms", icon: <FormIcon /> },
    { to: "/coordinator/responses", label: "My responses", icon: <ListIcon /> },
    { to: "/coordinator/notifications", label: <>Notifications{unread > 0 && <b className="nav-badge" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</b>}</>, icon: <BellIcon /> },
    { to: "/coordinator/profile", label: "Profile", icon: <UserIcon /> },
  ];
  const props = { user, onAuthExpired, unread, setUnread };
  return (
    <div className="portal cp">
      <AppBar title="Coordinator Portal" subtitle="Jamaat Coordinator" nav={nav} page={page} theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container myforms cp-main">
        {page === "/coordinator/forms" ? <MyForms onAuthExpired={onAuthExpired} />
          : page === "/coordinator/responses" ? <MyResponses {...props} />
          : page === "/coordinator/notifications" ? <Notifications {...props} />
          : page === "/coordinator/profile" ? <Profile {...props} />
          : <Home {...props} />}
      </main>
    </div>
  );
}

/* ---------- Home ---------- */
function Home({ user, onAuthExpired, unread }) {
  const { forms, msg } = useMyForms(onAuthExpired);
  const prof = useLoad(coordProfile, onAuthExpired);
  const notes = useLoad(coordNotifications, onAuthExpired);
  const p = prof.data && prof.data.profile;
  if (!forms) return <div className="panel portal-empty">{msg}</div>;
  const pending = forms.filter(isPending).sort((a, b) => new Date(a.endAt) - new Date(b.endAt));
  const soon = forms.filter(closingSoon);
  const filled = forms.filter((f) => f.filled > 0);
  const upcoming = forms.filter((f) => f.state === "not_started").sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const latest = notes.data ? notes.data.notifications.slice(0, 3) : [];
  const first = (user.name || user.username || "").split(" ")[0];

  return (
    <>
      <section className="page-head"><div className="page-title">
        <h1>Salaam{first && !first.includes("@") ? `, ${first}` : ""}</h1>
        <p className="page-sub">{p && p.jamaat ? <>Jamaat Coordinator of <b>{p.jamaat}</b>{p.jamiat ? <> · {p.jamiat}</> : null}</> : "Jamaat Coordinator"} · times in your time{myZone() ? ` (${myZone()})` : ""}</p>
      </div></section>

      <div className="kpis cp-kpis">
        <Kpi tone={pending.length ? "warn" : "good"} icon={pending.length ? <PencilIcon /> : <CheckIcon />} value={pending.length} label="To fill" sub={pending.length ? "Open forms you haven't filled" : "Nothing waiting for you"} to="/coordinator/forms" />
        <Kpi tone={soon.length ? "bad" : "na"} icon={<ClockIcon />} value={soon.length} label="Closing soon" sub="Not filled, close within 3 days" to="/coordinator/forms" />
        <Kpi tone="good" icon={<CheckIcon />} value={filled.length} label="Filled" sub={`Out of ${plural(forms.filter((f) => f.state !== "not_started").length, "form")}`} to="/coordinator/responses" />
        <Kpi tone={unread ? "brand" : "na"} icon={<BellIcon />} value={unread} label="Unread" sub="Notifications" to="/coordinator/notifications" />
      </div>

      <h2 className="myforms-sub">Needs your attention</h2>
      {pending.length ? <div className="myforms-list">{pending.map((f) => <FormCard key={f.id} f={f} />)}</div>
        : <div className="panel cp-allgood"><CheckIcon /> <span>You're all caught up — every open form is filled.</span></div>}

      {upcoming.length > 0 && (
        <>
          <h2 className="myforms-sub">Coming up</h2>
          <div className="panel cp-list">
            {upcoming.map((f) => (
              <div key={f.id} className="cp-list-row"><span className="myform-icon"><FormIcon /></span>
                <div><b>{f.title}</b><small className="muted">Opens {fmtWhen(f.startAt)} ({timeLeft(f.startAt)}) · closes {fmtWhen(f.endAt)}</small></div></div>
            ))}
          </div>
        </>
      )}

      <div className="cp-sub-head"><h2 className="myforms-sub">Latest notifications</h2>{latest.length > 0 && <Link to="/coordinator/notifications" className="link-btn">See all</Link>}</div>
      {!notes.data ? <div className="panel portal-empty">{notes.msg}</div>
        : !latest.length ? <div className="panel cp-empty"><BellIcon /> <span>No notifications yet. Reminders about your forms will appear here.</span></div>
        : <div className="cp-notes">{latest.map((n) => <NoteCard key={n.id} n={n} compact />)}</div>}
    </>
  );
}

function Kpi({ tone, icon, value, label, sub, to }) {
  return (
    <Link to={to} className="kpi cp-kpi">
      <div className="kpi-top"><span className="eyebrow">{label}</span><span className={`kpi-icon ${tone}`}>{icon}</span></div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </Link>
  );
}

/* ---------- My responses ---------- */
function MyResponses({ onAuthExpired }) {
  const { data, msg } = useLoad(coordResponses, onAuthExpired);
  const [form, setForm] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const formOf = useMemo(() => new Map(((data && data.forms) || []).map((f) => [f.id, f])), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = lower(query.trim());
    return data.rows.filter((r) => (!form || r.form === form)
      && (!q || lower([formOf.get(r.form).title, r.jamaat, ...Object.values(r.answers).map((v) => (Array.isArray(v) ? v.map((x) => (x && x.name) || x).join(" ") : v))].join(" ")).includes(q)));
  }, [data, form, query, formOf]);
  useEffect(() => { setOpen(null); }, [form, query]);

  return (
    <>
      <section className="page-head"><div className="page-title"><h1>My responses</h1>
        <p className="page-sub">Everything sent for your Jamaat — by you, or by your JC on your behalf. Open one to see the answers as they were filled.</p></div></section>
      {!data ? <div className="panel portal-empty">{msg}</div> : !data.rows.length ? <Notice type="info" text="You haven't filled any form yet." /> : (
        <>
          <div className="panel rs-panel cp-filter">
            <div className="rs-filters">
              <label className="field"><span className="field-label">Form</span>
                <select value={form} onChange={(e) => setForm(e.target.value)}>
                  <option value="">All forms</option>{data.forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                </select></label>
              <label className="field rs-search"><span className="field-label">Search</span>
                <input className="input" type="search" value={query} placeholder="Form or answer…" onChange={(e) => setQuery(e.target.value)} /></label>
            </div>
          </div>
          {!rows.length ? <div className="empty-state">No response matches.</div> : (
            <div className="cp-responses">
              {rows.map((r, i) => {
                const f = formOf.get(r.form);
                return (
                  <div key={i} className="panel cp-resp">
                    <span className="myform-icon"><FormIcon /></span>
                    <div className="cp-resp-text">
                      <b>{f.title}</b>{r.isTest && <span className="pill warn">Test</span>}{r.byJc && <span className="pill info">Filled by your JC{r.byJc.name ? ` (${r.byJc.name})` : ""}</span>}
                      <small className="muted">Sent {fmtWhen(r.submittedAt)}{r.editedAt ? ` · changed ${fmtWhen(r.editedAt)}` : ""}{r.jamaat ? ` · ${r.jamaat}` : ""}</small>
                    </div>
                    <div className="cp-resp-actions">
                      <button type="button" className="btn btn-primary" onClick={() => setOpen(i)}><EyeIcon /> <span>View</span></button>
                      {f.editLink && <a className="btn btn-ghost" href={f.editLink}><PencilIcon /> <span>Change</span></a>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {open != null && rows[open] && (
            <ResponseView form={formOf.get(rows[open].form)} row={rows[open]} n={open + 1} total={rows.length} onClose={() => setOpen(null)}
              onPrev={open > 0 ? () => setOpen(open - 1) : null} onNext={open < rows.length - 1 ? () => setOpen(open + 1) : null} />
          )}
        </>
      )}
    </>
  );
}

/* ---------- Notifications ---------- */
const KIND = { reminder: { label: "Reminder", tone: "warn" }, form: { label: "Form", tone: "info" }, info: { label: "Notice", tone: "na" } };

function NoteCard({ n, compact, onRead }) {
  const k = KIND[n.kind] || KIND.info;
  return (
    <div className={`panel cp-note${n.read ? "" : " is-unread"}${compact ? " is-compact" : ""}`} onClick={() => !n.read && onRead && onRead(n)}>
      <span className="cp-note-dot" aria-label={n.read ? "Read" : "Unread"} />
      <div className="cp-note-body">
        <div className="cp-note-head"><span className={`pill ${k.tone}`}>{k.label}</span><b>{n.title}</b><small className="muted">{fmtWhen(n.at)}</small></div>
        {n.body && <p className={compact ? "cp-note-clip" : ""}>{n.body}</p>}
        {n.form && (
          <div className="cp-note-form">
            <span className="muted">{n.form.title}{n.form.endAt ? ` · closes ${fmtWhen(n.form.endAt)}` : ""}</span>
            {n.form.link ? <a className="btn btn-primary" href={n.form.link} onClick={() => !n.read && onRead && onRead(n)}>Open the form</a> : <span className="pill na">Form closed</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Notifications({ onAuthExpired, setUnread }) {
  const { data, setData, msg } = useLoad(coordNotifications, onAuthExpired);
  const [only, setOnly] = useState("all");
  const [err, setErr] = useState("");
  const mark = async (n) => {
    try {
      const r = await coordMarkRead(n ? n.id : null);
      setUnread(r.unread);
      setData((d) => ({ ...d, unread: r.unread, notifications: d.notifications.map((x) => (!n || x.id === n.id ? { ...x, read: true } : x)) }));
    } catch (e) { if (e instanceof AuthError) onAuthExpired(); else setErr(e.message); }
  };
  if (!data) return <div className="panel portal-empty">{msg}</div>;
  const list = data.notifications.filter((n) => only === "all" || !n.read);
  const unread = data.notifications.filter((n) => !n.read).length;
  return (
    <>
      <section className="page-head"><div className="page-title"><h1>Notifications</h1>
        <p className="page-sub">Reminders and messages about your forms. Reminders sent by email appear here too.</p></div>
        {unread > 0 && <button type="button" className="btn btn-ghost" onClick={() => mark(null)}><CheckIcon /> <span>Mark all as read</span></button>}
      </section>
      {err && <Notice type="error" text={err} onClose={() => setErr("")} />}
      <div className="cp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={only === "all"} className={only === "all" ? "is-on" : ""} onClick={() => setOnly("all")}>All <span className="cp-count">{data.notifications.length}</span></button>
        <button type="button" role="tab" aria-selected={only === "unread"} className={only === "unread" ? "is-on" : ""} onClick={() => setOnly("unread")}>Unread <span className="cp-count">{unread}</span></button>
      </div>
      {!list.length
        ? <div className="panel cp-empty"><BellIcon /> <span>{only === "unread" ? "No unread notifications." : "No notifications yet. Reminders about your forms will appear here."}</span></div>
        : <div className="cp-notes">{list.map((n) => <NoteCard key={n.id} n={n} onRead={mark} />)}</div>}
    </>
  );
}

/* ---------- Profile ---------- */
function Profile({ onAuthExpired }) {
  const { data, msg } = useLoad(coordProfile, onAuthExpired);
  if (!data) return <div className="panel portal-empty">{msg}</div>;
  const p = data.profile;
  const Row = ({ label, children }) => <div className="cp-prof-row"><span className="field-label">{label}</span><div>{children}</div></div>;
  return (
    <>
      <section className="page-head"><div className="page-title"><h1>Profile</h1><p className="page-sub">Your details in the portal.</p></div></section>
      <div className="panel cp-profile">
        <div className="cp-prof-top">
          <span className="cp-avatar" aria-hidden="true">{(p.name || p.email || "?").slice(0, 1).toUpperCase()}</span>
          <div><h2>{p.name || p.email}</h2><p className="muted">{p.role}{p.isTester ? " · Form tester" : ""}</p></div>
        </div>
        <div className="cp-prof-grid">
          <Row label="Gmail"><span className="fill-locked"><LockIcon /> {p.email}</span></Row>
          <Row label="Name (from your Google account)"><span className="fill-locked"><LockIcon /> {p.name || "—"}</span></Row>
          <Row label="Jamiat"><span className="fill-locked"><LockIcon /> {p.jamiat || "—"}</span></Row>
          <Row label="Jamaat"><span className="fill-locked"><LockIcon /> {p.jamaat || "—"}</span></Row>
          <Row label="In the portal since"><p>{fmtWhen(p.since)}</p></Row>
          <Row label="Last sign-in"><p>{p.lastLoginAt ? fmtWhen(p.lastLoginAt) : "—"}</p></Row>
        </div>
        {!p.jamaat && <Notice type="info" text="No Jamaat is assigned to you yet. Please contact the Super Admin." />}
        <p className="cp-prof-note"><WarnIcon /> <span>These details are set by the Super Admin. If something is wrong, please contact them.</span></p>
      </div>
    </>
  );
}
