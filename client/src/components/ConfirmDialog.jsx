import { useEffect, useRef, useState } from "react";
import { InfoIcon, PauseIcon, TrashIcon, WarnIcon } from "./Icons";

// The app's own confirmation popup (replaces the browser's window.confirm).
//
//   if (!(await confirmDialog({ title, message, confirmText, tone }))) return;
//
// tone: "danger" (delete), "warn" (inactive / sign-out effects), "caution" (discard unsaved work), "info" (everything else).
// message: a string (blank lines = paragraphs) or an array of paragraphs.
// Resolves true on the confirm button, false on Cancel / Esc / clicking outside.
// <ConfirmHost /> is mounted once in App; only one popup is shown at a time.

let show = null; // set by the mounted host
const queue = [];

export function confirmDialog(opts) {
  return new Promise((resolve) => {
    const req = { ...opts, resolve };
    if (show) show(req);
    else queue.push(req);
  });
}

const ICONS = { danger: TrashIcon, warn: PauseIcon, info: InfoIcon, caution: WarnIcon };

export function ConfirmHost() {
  const ref = useRef(null);
  const okRef = useRef(null);
  const cancelRef = useRef(null);
  const [req, setReq] = useState(null);
  const pending = useRef([]);

  useEffect(() => {
    show = (r) => setReq((cur) => { if (cur) { pending.current.push(r); return cur; } return r; });
    while (queue.length) show(queue.shift());
    return () => { show = null; };
  }, []);

  useEffect(() => {
    const dlg = ref.current;
    if (req && !dlg.open) dlg.showModal();
    // Delete popups start on Cancel so a stray Enter doesn't delete; others start on the main button.
    if (req) (req.tone === "danger" ? cancelRef : okRef).current?.focus();
    if (!req && dlg.open) dlg.close();
  }, [req]);

  const finish = (answer) => {
    if (!req) return;
    req.resolve(answer);
    setReq(pending.current.shift() || null);
  };

  const tone = (req && req.tone) || "info";
  const Icon = ICONS[tone] || InfoIcon;
  const paras = !req ? [] : Array.isArray(req.message) ? req.message : String(req.message || "").split(/\n\s*\n/);

  return (
    <dialog ref={ref} className={`confirm-dlg cd-${tone}`} aria-labelledby="confirmTitle" aria-describedby="confirmMsg"
      onCancel={(e) => { e.preventDefault(); finish(false); }}
      onClick={(e) => { if (e.target === ref.current) finish(false); }}>
      {req && (
        <>
          <div className="confirm-main">
            <span className="confirm-icon"><Icon /></span>
            <div className="confirm-text">
              <h2 id="confirmTitle">{req.title}</h2>
              <div id="confirmMsg">{paras.filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
            </div>
          </div>
          <div className="confirm-actions">
            <button type="button" ref={cancelRef} className="btn btn-ghost" onClick={() => finish(false)}>{req.cancelText || "Cancel"}</button>
            <button type="button" ref={okRef} className={`btn ${tone === "danger" ? "btn-danger" : tone === "warn" || tone === "caution" ? "btn-warn" : "btn-primary"}`}
              onClick={() => finish(true)}>{req.confirmText || "OK"}</button>
          </div>
        </>
      )}
    </dialog>
  );
}
