import { useCallback, useEffect, useState } from "react";
import AppBar from "./components/AppBar";
import Notice from "./components/Notice";
import { fmtWhen, myZone } from "./components/FormView";
import { FormIcon } from "./components/Icons";
import { AuthError, isServerStarting, myForms } from "./lib/api";

// Jamaat Coordinator: the forms they can fill ("My forms").
const STATE = {
  open: { label: "Open", tone: "good" },
  not_started: { label: "Not open yet", tone: "info" },
  testing: { label: "Testing", tone: "warn" },
  ended: { label: "Closed", tone: "na" },
  closed: { label: "Closed", tone: "na" },
};

export default function MyForms({ user, onSignOut, onAuthExpired, theme, onToggleTheme }) {
  const [forms, setForms] = useState(null);
  const [msg, setMsg] = useState("Loading…");

  const load = useCallback(async (tries = 0) => {
    try { setForms((await myForms()).forms); }
    catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) { setMsg("Connecting to the server…"); setTimeout(() => load(tries + 1), 5000); }
      else setMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const b = document.title; document.title = "My forms · Umoor Sehhat"; return () => { document.title = b; }; }, []);

  const live = (forms || []).filter((f) => ["open", "not_started", "testing"].includes(f.state));
  const past = (forms || []).filter((f) => !live.includes(f));
  const card = (f) => {
    const s = STATE[f.state] || STATE.closed;
    const canFill = ["open", "testing"].includes(f.state) && (f.maxPerPerson == null || f.filled < f.maxPerPerson || f.allowEdit);
    return (
      <div key={f.id} className="panel myform">
        <div className="myform-head">
          <span className="myform-icon"><FormIcon /></span>
          <div>
            <h2>{f.title}</h2>
            {f.description && <p className="muted">{f.description}</p>}
          </div>
          <span className={`pill ${s.tone}`}>{s.label}</span>
        </div>
        <p className="myform-when">
          {f.state === "not_started" ? <>Opens <b>{fmtWhen(f.startAt)}</b></> : <>Closes <b>{fmtWhen(f.endAt)}</b></>}
          <span className="muted"> (your time)</span>
          {f.filled ? <> · <span className="pill good">Filled{f.filled > 1 ? ` ${f.filled} times` : ""}</span></> : null}
        </p>
        {canFill && (
          <a className="btn btn-primary" href={f.link}>
            {f.filled && f.maxPerPerson != null && f.filled >= f.maxPerPerson ? "See / change my response" : f.filled ? "Fill again" : "Fill the form"}
          </a>
        )}
      </div>
    );
  };

  return (
    <div className="portal">
      <AppBar title="My forms" subtitle="Jamaat Coordinator" theme={theme} onToggleTheme={onToggleTheme} user={user} onSignOut={onSignOut} />
      <main className="container myforms">
        <section className="page-head"><div className="page-title"><h1>My forms</h1>
          <p className="page-sub">Forms you are asked to fill. Times are shown in your time{myZone() ? ` (${myZone()})` : ""}.</p></div></section>
        {!forms ? <div className="panel portal-empty">{msg}</div> : (
          <>
            {!forms.length && <Notice type="info" text="There are no forms for you yet." />}
            {live.length > 0 && <div className="myforms-list">{live.map(card)}</div>}
            {past.length > 0 && <><h2 className="myforms-sub">Closed</h2><div className="myforms-list">{past.map(card)}</div></>}
          </>
        )}
      </main>
    </div>
  );
}
