import { useCallback, useEffect, useState } from "react";
import Notice from "./components/Notice";
import { confirmDialog } from "./components/ConfirmDialog";
import { AuthError, storageSet, storageSettings, storageTest } from "./lib/api";

// Super Admin → Settings → Image storage: where new uploads are saved (like the email provider choice).
// Every file remembers where it was saved, so switching never breaks older files.
const ABOUT = {
  imagekit: "Saves, resizes and shows pictures; private files open with links that expire. The default, and always the backup: if the chosen storage fails or isn't set up, files are saved here instead.",
  local: "Files are kept on the server itself (no outside service). On Render they are lost at every restart or deploy unless a Render Disk is attached — only use it with a disk. The server makes the smaller copies.",
  s3: "Amazon S3 (or another S3-compatible storage such as Cloudflare R2 or Wasabi). Private files open with links that expire. S3 can't resize, so the server makes the smaller copies for reports; thumbnails show the original picture.",
  cloudinary: "Saves, resizes and shows pictures. Private files open only with signed links (Cloudinary's links don't expire unless its paid token feature is used).",
};

export default function StorageSettings({ onAuthExpired }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const fail = useCallback((e) => { if (e instanceof AuthError) return onAuthExpired(); setMsg({ type: "error", text: e.message }); }, [onAuthExpired]);
  useEffect(() => { storageSettings().then(setS).catch(fail); }, [fail]);

  const use = async (p) => {
    if (p.name === "local" && !(await confirmDialog({
      tone: "warn", title: "Save new files on the server?", confirmText: "Use Local",
      message: "On Render, files kept on the server are lost at every restart and deploy unless a Render Disk is attached (LOCAL_UPLOAD_DIR = the disk's path).\n\nUse it only when the disk is set up.",
    }))) return;
    setBusy(`use-${p.name}`); setMsg(null);
    try { setS(await storageSet(p.name)); setMsg({ type: "ok", text: `New uploads are now saved in ${p.label}. Files saved earlier stay where they are and keep opening.` }); } catch (e) { fail(e); } finally { setBusy(""); }
  };
  const test = async (p) => {
    setBusy(`test-${p.name}`); setMsg(null);
    try {
      const r = await storageTest(p.name);
      setMsg({ type: "ok", text: `${p.label} works: a test picture was saved, read back, made smaller and removed (${(r.ms / 1000).toFixed(1)} s).` });
    } catch (e) { fail(e); } finally { setBusy(""); }
  };

  return (
    <>
      <section className="page-head"><div className="page-title"><h1>Settings</h1>
        <p className="page-sub">Image storage: where pictures and files uploaded in the portal are saved — form photos, videos and files, Stats pictures, email attachments and email images.</p></div></section>
      {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}
      {!s ? <div className="panel em-loading">Loading…</div> : (
        <>
          <div className="em-provs st-provs">
            {s.providers.map((p) => {
              const on = s.active === p.name;
              return (
                <section key={p.name} className={`panel em-prov${on ? " is-on" : ""}`}>
                  <div className="em-prov-head">
                    <h2>{p.label}</h2>
                    {on && <span className="pill good">In use</span>}
                    {p.name === s.fallback && <span className="pill info">Backup</span>}
                  </div>
                  <p className="em-prov-sub">{ABOUT[p.name]}</p>
                  <div className={`em-prov-state${p.configured ? " ok" : ""}`}>
                    {p.configured ? <>✓ Set up on the server</> : <>Not set up on the server. Add these on Render: <ul>{p.needs.map((x) => <li key={x}><code>{x}</code></li>)}</ul></>}
                  </div>
                  <div className="em-prov-actions">
                    {!on && <button type="button" className="btn btn-primary" disabled={!!busy || !p.configured} onClick={() => use(p)} title={p.configured ? "" : "Set it up on the server first"}>{busy === `use-${p.name}` ? "Switching…" : "Use this"}</button>}
                    <button type="button" className="btn btn-ghost" disabled={!!busy || !p.configured} onClick={() => test(p)}>{busy === `test-${p.name}` ? "Testing…" : "Test it"}</button>
                  </div>
                </section>
              );
            })}
          </div>
          <p className="field-hint em-note">Keys are kept only in the server settings (Render), never in the portal. Switching takes effect at once for new uploads; files saved earlier stay in the storage they were saved in and keep opening (keep that storage's keys on the server).</p>
        </>
      )}
    </>
  );
}
