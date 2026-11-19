import { useEffect, useRef, useState } from "react";
import { AuthError, chatAsk } from "../lib/api";
import { CloseIcon, SendIcon, SparkIcon, TrashIcon } from "./Icons";

// The assistant: a round button at the bottom right that opens a chat panel, on every portal.
// Answers come from the server, limited to what this person may see (a JC only their Jamaats).
const EXAMPLES = {
  jc: ["Which of my Jamaats have not submitted the form?", "Which Jamaats have Injection completed?", "How many are pending for Tibb?", "Show the answers of one of my Jamaats"],
  saheb: ["Which Jamiats have filled Tibb?", "Which Jamiats have Injection done?", "How many Jamaats submitted the form this month?", "Show the comments on Tibb"],
  superadmin: ["Who is the JC of Dhar?", "Which Jamiats have Injection done?", "How many Jamaats are in Barwani?", "List all JCs"],
};
const STORE = (id) => `chat:${id}`;
const load = (id) => { try { return JSON.parse(sessionStorage.getItem(STORE(id)) || "[]"); } catch { return []; } };
const save = (id, msgs) => { try { sessionStorage.setItem(STORE(id), JSON.stringify(msgs.slice(-40))); } catch { /* storage blocked */ } };

// "**bold**" in the server's text -> <b>
function Rich({ text }) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
}

function Blocks({ blocks, onAsk }) {
  return blocks.map((b, i) => {
    if (b.type === "table") {
      return (
        <div key={i} className="chat-table-wrap">
          <table className="chat-table">
            <thead><tr>{b.columns.map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
          </table>
          {b.note && <p className="chat-note">{b.note}</p>}
        </div>
      );
    }
    if (b.type === "examples") {
      return (
        <div key={i} className="chat-examples">
          {b.items.map((q) => <button key={q} type="button" className="chat-chip" onClick={() => onAsk(q)}>{q}</button>)}
        </div>
      );
    }
    return <p key={i} className="chat-text"><Rich text={b.text} /></p>;
  });
}

export default function ChatWidget({ user, onAuthExpired, raised }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(() => load(user.id));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { save(user.id, msgs); }, [user.id, msgs]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ask = async (text) => {
    const q = String(text || "").trim();
    if (!q || busy) return;
    // Earlier questions and how the server read them, so follow-ups like "and in Barwani?" work.
    const history = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role === "bot" && m.intent && msgs[i - 1] && msgs[i - 1].role === "user") history.push({ q: msgs[i - 1].text, intent: m.intent });
    }
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await chatAsk(q, history.slice(-6));
      setMsgs((m) => [...m, { role: "bot", blocks: res.blocks, intent: res.intent }]);
    } catch (err) {
      if (err instanceof AuthError) { onAuthExpired(); return; }
      setMsgs((m) => [...m, { role: "bot", error: true, blocks: [{ type: "text", text: err.message || "Something went wrong. Please try again." }] }]);
    } finally {
      setBusy(false);
    }
  };

  const examples = EXAMPLES[user.role] || EXAMPLES.saheb;

  return (
    <>
      <button type="button" className={`chat-fab${raised ? " raised" : ""}${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-controls="chat-panel" title={open ? "Close the assistant" : "Ask the assistant"}>
        {open ? <CloseIcon /> : <SparkIcon />}
        <span className="chat-fab-label">Ask</span>
      </button>

      {open && (
        <section id="chat-panel" className={`chat-panel${raised ? " raised" : ""}`} role="dialog" aria-label="Assistant">
          <header className="chat-head">
            <span className="chat-head-icon"><SparkIcon size={18} /></span>
            <div className="chat-head-text">
              <b>Assistant</b>
              <small>{user.role === "jc" ? "Answers from your Jamaats' data" : "Answers from the portal's data"}</small>
            </div>
            {msgs.length > 0 && (
              <button type="button" className="icon-btn" onClick={() => setMsgs([])} title="Clear the chat" aria-label="Clear the chat"><TrashIcon /></button>
            )}
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="Close" aria-label="Close the assistant"><CloseIcon /></button>
          </header>

          <div className="chat-list" ref={listRef} aria-live="polite">
            {!msgs.length && (
              <div className="chat-welcome">
                <p><b>Salaam!</b> Ask about the JC form data in plain English: answers, activities and dates, submitted forms, comments, Jamiats and Jamaats, for any month of the last 3 years.</p>
                <p className="muted">For example:</p>
                <div className="chat-examples">
                  {examples.map((q) => <button key={q} type="button" className="chat-chip" onClick={() => ask(q)}>{q}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}${m.error ? " is-error" : ""}`}>
                {m.role === "user" ? <p className="chat-text">{m.text}</p> : <Blocks blocks={m.blocks || []} onAsk={ask} />}
              </div>
            ))}
            {busy && <div className="chat-msg bot"><span className="chat-typing" aria-label="Looking it up"><i /><i /><i /></span></div>}
          </div>

          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <textarea ref={inputRef} rows={1} value={input} maxLength={500} placeholder="Ask a question…" aria-label="Your question"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }} />
            <button type="submit" className="chat-send" disabled={busy || !input.trim()} aria-label="Send"><SendIcon /></button>
          </form>
        </section>
      )}
    </>
  );
}
