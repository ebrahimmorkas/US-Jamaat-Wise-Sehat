import { useCallback, useEffect, useState } from "react";
import Notice from "./components/Notice";
import { fmtWhen, myZone } from "./components/FormView";
import { FormIcon } from "./components/Icons";
import { AuthError, isServerStarting, myForms } from "./lib/api";

// Jamaat Coordinator: the forms they can fill ("My forms"). Shown inside the Coordinator portal.
export const STATE = {
  open: { label: "Open", tone: "good" },
  not_started: { label: "Not open yet", tone: "info" },
  testing: { label: "Testing", tone: "warn" },
  ended: { label: "Closed", tone: "na" },
  closed: { label: "Closed", tone: "na" },
};

/** "in 3 days", "in 5 hours", "in 20 minutes" (until a date in the future). */
export function timeLeft(d) {
  const ms = new Date(d).getTime() - Date.now();
  if (!(ms > 0)) return "";
  const min = Math.round(ms / 60000);
  if (min < 60) return `in ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 48) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const days = Math.round(h / 24);
  return `in ${days} days`;
}
const SOON_MS = 3 * 24 * 3600 * 1000;
export const isFillable = (f) => ["open", "testing"].includes(f.state) && (f.maxPerPerson == null || f.filled < f.maxPerPerson || f.allowEdit);
export const isPending = (f) => ["open", "testing"].includes(f.state) && !f.filled;
export const closingSoon = (f) => isPending(f) && f.endAt && new Date(f.endAt).getTime() - Date.now() < SOON_MS;

/** One form as a card (also used on Home). */
export function FormCard({ f }) {
  const s = STATE[f.state] || STATE.closed;
  const soon = closingSoon(f);
  return (
    <div className={`panel myform${soon ? " is-soon" : ""}`}>
      <div className="myform-head">
        <span className="myform-icon"><FormIcon /></span>
        <div>
          <h2>{f.title}</h2>
          {f.description && <p className="muted">{f.description}</p>}
        </div>
        <span className={`pill ${s.tone}`}>{s.label}</span>
      </div>
      <p className="myform-when">
        {f.state === "not_started"
          ? <>Opens <b>{fmtWhen(f.startAt)}</b> <span className="muted">({timeLeft(f.startAt)})</span></>
          : ["open", "testing"].includes(f.state)
            ? <>Closes <b>{fmtWhen(f.endAt)}</b> <span className={soon ? "myform-soon" : "muted"}>({timeLeft(f.endAt)})</span></>
            : <>Closed <b>{fmtWhen(f.endAt)}</b></>}
        {f.filled ? <> · <span className="pill good">Filled{f.filled > 1 ? ` ${f.filled} times` : ""}</span></> : ["open", "testing"].includes(f.state) ? <> · <span className="pill warn">Not filled yet</span></> : null}
      </p>
      {isFillable(f) && (
        <a className="btn btn-primary" href={f.link}>
          {f.filled && f.maxPerPerson != null && f.filled >= f.maxPerPerson ? "See / change my response" : f.filled ? "Fill again" : "Fill the form"}
        </a>
      )}
    </div>
  );
}

/** Loads the Coordinator's forms (retries while the server wakes up). */
export function useMyForms(onAuthExpired) {
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
  return { forms, msg };
}

export default function MyForms({ onAuthExpired }) {
  const { forms, msg } = useMyForms(onAuthExpired);
  const [tab, setTab] = useState("open");
  const live = (forms || []).filter((f) => ["open", "testing"].includes(f.state));
  const soon = (forms || []).filter((f) => f.state === "not_started");
  const past = (forms || []).filter((f) => !live.includes(f) && !soon.includes(f));
  const tabs = [["open", "Open now", live], ["soon", "Coming up", soon], ["closed", "Closed", past]];
  const shown = (tabs.find((t) => t[0] === tab) || tabs[0])[2];

  return (
    <>
      <section className="page-head"><div className="page-title"><h1>My forms</h1>
        <p className="page-sub">Forms you are asked to fill. Times are shown in your time{myZone() ? ` (${myZone()})` : ""}.</p></div></section>
      {!forms ? <div className="panel portal-empty">{msg}</div> : (
        <>
          <div className="cp-tabs" role="tablist">
            {tabs.map(([k, label, list]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
                {label} <span className="cp-count">{list.length}</span>
              </button>
            ))}
          </div>
          {!shown.length
            ? <Notice type="info" text={tab === "open" ? "No form is open for you right now." : tab === "soon" ? "No forms are coming up." : "No closed forms yet."} />
            : <div className="myforms-list">{shown.map((f) => <FormCard key={f.id} f={f} />)}</div>}
        </>
      )}
    </>
  );
}
