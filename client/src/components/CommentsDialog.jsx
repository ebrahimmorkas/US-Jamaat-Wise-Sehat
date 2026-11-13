import { useEffect, useRef, useState } from "react";
import { AuthError } from "../lib/api";
import { lower, plural } from "../lib/helpers";
import { CloseIcon } from "./Icons";
import StatusPill from "./StatusPill";

const fmt = (d) => (d ? new Date(d).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

// Popup with the comments JCs typed under the questions. The text is fetched only when the popup
// opens (the server logs that); the dashboards themselves only know how many comments there are.
//   request = { load: () => Promise, title, scopeText, inScope?: (c) => bool, question?, jamaatId?, jamaatName? }
export default function CommentsDialog({ request, onClose, onAuthExpired }) {
  const ref = useRef(null);
  const [state, setState] = useState({ loading: false, error: "", data: null });
  const [question, setQuestion] = useState("");
  const [jamaatId, setJamaatId] = useState("");
  const [query, setQuery] = useState("");
  const [tries, setTries] = useState(0);
  const cb = useRef({});
  cb.current = { onClose, onAuthExpired };

  useEffect(() => {
    const dlg = ref.current;
    if (request && !dlg.open) dlg.showModal();
    if (!request && dlg.open) dlg.close();
    if (!request) return;
    setQuestion(request.question || "");
    setJamaatId(request.jamaatId || "");
    setQuery("");
  }, [request]);

  useEffect(() => {
    if (!request) return;
    let alive = true;
    setState({ loading: true, error: "", data: null });
    request.load()
      .then((data) => alive && setState({ loading: false, error: "", data }))
      .catch((err) => {
        if (!alive) return;
        if (err instanceof AuthError) { cb.current.onClose(); cb.current.onAuthExpired && cb.current.onAuthExpired(); return; }
        setState({ loading: false, error: err.message, data: null });
      });
    return () => { alive = false; };
  }, [request, tries]);

  const data = state.data;
  const inScope = (request && request.inScope) || (() => true);
  const all = data ? data.comments.filter(inScope) : [];
  const q = lower(query);
  const shown = all.filter((c) =>
    (!question || c.key === question) && (!jamaatId || c.jamaatId === jamaatId)
    && (!q || lower(c.text).includes(q) || lower(c.jamaat).includes(q) || lower(c.jamiat).includes(q)));
  const qOf = (key) => (data && data.questions.find((x) => x.key === key)) || { label: key, options: [] };
  const toneOf = (key, v) => (qOf(key).options.find((o) => lower(o.value) === lower(v)) || { tone: "na" }).tone;
  const usedQuestions = data ? data.questions.filter((x) => all.some((c) => c.key === x.key)) : [];
  const jamaatName = jamaatId && ((all.find((c) => c.jamaatId === jamaatId) || {}).jamaat || (request && request.jamaatName));

  let body;
  if (state.loading) body = <div className="empty-state">Loading comments…</div>;
  else if (state.error) body = <div className="empty-state">{state.error} <button type="button" className="mini-btn" onClick={() => setTries((n) => n + 1)}>Try again</button></div>;
  else if (!all.length) body = <div className="empty-state">No comments for {data ? data.monthLabel : "this month"}{request && request.scopeText ? ` in ${request.scopeText}` : ""}.</div>;
  else if (!shown.length) body = <div className="empty-state">No comments match.</div>;
  else {
    body = (
      <ul className="cmt-list">
        {shown.map((c, i) => (
          <li key={`${c.jamaatId}|${c.key}|${i}`} className="cmt">
            <div className="cmt-head">
              <span className="cmt-place"><b>{c.jamaat}</b><span className="muted"> · {c.jamiat}</span></span>
              <span className="cmt-date">{fmt(c.savedAt)}</span>
            </div>
            <div className="cmt-q">
              <span>{qOf(c.key).label}</span>
              {c.answer && <StatusPill status={c.answer} tone={toneOf(c.key, c.answer)} />}
            </div>
            <p className="cmt-text">{c.text}</p>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <dialog ref={ref} className="cmt-dlg" aria-labelledby="cmtTitle" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {request && (
        <>
          <div className="dlg-head">
            <div>
              <div className="eyebrow">Comments by JCs</div>
              <h2 id="cmtTitle">{request.title || "Comments"}</h2>
              <p>{[data && data.monthLabel, request.scopeText, data && plural(shown.length, "comment")].filter(Boolean).join(" · ")}</p>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
          </div>
          {data && all.length > 0 && (
            <div className="dlg-tools cmt-tools">
              <select value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question">
                <option value="">All questions ({all.length})</option>
                {usedQuestions.map((x) => <option key={x.key} value={x.key}>{x.label} ({all.filter((c) => c.key === x.key).length})</option>)}
              </select>
              <input type="search" placeholder="Search comment, Jamaat or Jamiat…" aria-label="Search comments"
                value={query} onChange={(e) => setQuery(e.target.value)} />
              {jamaatId && (
                <span className="cmt-chip">Only {jamaatName}
                  <button type="button" onClick={() => setJamaatId("")} aria-label="Show all Jamaats"><CloseIcon /></button>
                </span>
              )}
            </div>
          )}
          <div className="dlg-body">{body}</div>
        </>
      )}
    </dialog>
  );
}
