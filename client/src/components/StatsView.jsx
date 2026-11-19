import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, deleteStat, fetchStats, isServerStarting, uploadStat } from "../lib/api";
import { useRealtime } from "../hooks/useRealtime";
import { confirmDialog } from "./ConfirmDialog";
import Notice from "./Notice";
import { ChevronLeft, ChevronRight, CloseIcon, ImageIcon, TrashIcon, UploadIcon } from "./Icons";

// "Stats", Jamiat-wise: each Jamiat has its current image (shown whole, never cropped, with its date) and
// its history. JCs get only their Jamiats (the server decides). admin = upload for a Jamiat / remove.
// topic = live updates ("portal" / "dashboard").
const MAX_MB = 8;
const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const sizeOf = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// The picture comes straight from ImageKit through a signed link that expires (see the server).
// If it doesn't load (e.g. the page was open longer than the link lasts), onStale fetches new links once.
function StatImg({ image, alt, className, onClick, onStale }) {
  const [state, setState] = useState("loading"); // loading | ok | failed
  const retried = useRef(false);
  useEffect(() => { setState("loading"); }, [image.src]);
  if (!image.src) return <div className={`stat-img-missing ${className || ""}`}>The image storage is not set up on the server.</div>;
  if (state === "failed") return <div className={`stat-img-missing ${className || ""}`}>The image could not be loaded. Reload the page.</div>;
  const img = (
    <img src={image.src} alt={alt} className={`${className || ""}${state === "loading" ? " is-loading" : ""}`}
      width={image.width || undefined} height={image.height || undefined} decoding="async"
      onLoad={() => { setState("ok"); retried.current = false; }}
      onError={() => {
        if (!retried.current && onStale) { retried.current = true; onStale(); } else setState("failed");
      }} />
  );
  return onClick ? <button type="button" className="stat-img-btn" onClick={onClick} aria-label={`Open ${alt} full size`}>{img}</button> : img;
}

export default function StatsView({ onAuthExpired, admin = false, topic }) {
  const [groups, setGroups] = useState(null); // [{ id, name, images }]
  const [sel, setSel] = useState("");          // Jamiat shown
  const [error, setError] = useState("");
  const [msg, setMsg] = useState(null);
  const [view, setView] = useState(-1); // index open full size
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const retry = useRef(null);

  const load = useCallback(async (tries = 0) => {
    try {
      const r = await fetchStats();
      setGroups(r.jamiats);
      // Keep the chosen Jamiat; else the first one that has an image; else the first.
      setSel((cur) => (r.jamiats.some((g) => g.id === cur) ? cur : ((r.jamiats.find((g) => g.images.length) || r.jamiats[0] || {}).id || "")));
      setError("");
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setError("Connecting to the server…");
        retry.current = setTimeout(() => load(tries + 1), 5000);
        return;
      }
      setError(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); return () => clearTimeout(retry.current); }, [load]);
  useRealtime(topic, "stats:changed", () => load(), { enabled: !!topic, onReconnect: () => load() });

  const group = groups && groups.find((g) => g.id === sel);
  const list = groups ? (group ? group.images : []) : null;
  const setList = (fn) => setGroups((gs) => gs.map((g) => (g.id === sel ? { ...g, images: fn(g.images) } : g)));
  const choose = (id) => { setSel(id); setView(-1); setMsg(null); };

  const fail = (err, what) => {
    if (err instanceof AuthError) return onAuthExpired();
    setMsg({ type: "error", text: `${what}: ${err.message}` });
  };

  const pick = (f) => {
    setMsg(null);
    if (!f) return setFile(null);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { setFile(null); return setMsg({ type: "error", text: "Choose a PNG, JPG, WebP or GIF image." }); }
    if (f.size > MAX_MB * 1048576) { setFile(null); return setMsg({ type: "error", text: `The image is ${sizeOf(f.size)}. The limit is ${MAX_MB} MB.` }); }
    setFile(f);
  };
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) return setPreview("");
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const upload = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const s = await uploadStat(file, title, sel);
      setList((l) => [s, ...l]);
      setFile(null); setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      setMsg({ type: "ok", text: `Uploaded for ${group.name}. Its JCs, the Saheb and you now see the new image; the previous one moved to ${group.name}'s history.` });
    } catch (err) { fail(err, "Not uploaded"); } finally { setBusy(false); }
  };

  const remove = async (s, i) => {
    const ok = await confirmDialog({
      tone: "danger", title: "Remove this image?", confirmText: "Remove",
      message: i === 0 && list.length > 1
        ? `${group.name}'s current image (uploaded ${fmtDate(s.uploadedAt)}) will be removed from every portal. The image uploaded ${fmtDate(list[1].uploadedAt)} becomes the current one again.`
        : `${group.name}'s image uploaded ${fmtDate(s.uploadedAt)} will be removed from every portal. This can't be undone.`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteStat(s.id);
      setList((l) => l.filter((x) => x.id !== s.id));
      setView(-1);
      setMsg({ type: "ok", text: "Image removed." });
    } catch (err) { fail(err, "Not removed"); } finally { setBusy(false); }
  };

  // Full-size viewer: arrows / Esc.
  useEffect(() => {
    if (view < 0) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setView(-1);
      else if (e.key === "ArrowLeft") setView((v) => Math.min(list.length - 1, v + 1)); // older
      else if (e.key === "ArrowRight") setView((v) => Math.max(0, v - 1)); // newer
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [view, list]);

  const current = list && list[0];
  const history = list ? list.slice(1) : [];
  const name = (s) => s.title || "Stats";
  const until = (i) => list[i - 1] && list[i - 1].uploadedAt; // the next upload replaced it

  return (
    <div className="stats-view">
      {error && <Notice type={groups ? "error" : "info"} text={error} onClose={groups ? () => setError("") : undefined} />}
      {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}

      {groups && groups.length === 0 && (
        <section className="panel stats-empty"><ImageIcon /><p>{admin ? "There are no Jamiats yet. Add them in Masters first." : "No Jamiat is assigned to you yet."}</p></section>
      )}

      {groups && groups.length > 0 && (
        <section className="panel stats-pick">
          {groups.length > 1 ? (
            <label className="field">
              <span className="field-label">Jamiat</span>
              <select value={sel} onChange={(e) => choose(e.target.value)} aria-label="Jamiat">
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} — {g.images.length ? `updated ${fmtDate(g.images[0].uploadedAt)}` : "no image yet"}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="stats-one"><span className="field-label">Jamiat</span><b>{group && group.name}</b></div>
          )}
          {groups.length > 1 && (
            <p className="muted stats-pick-sum">{groups.filter((g) => g.images.length).length} of {groups.length} Jamiats have an image</p>
          )}
        </section>
      )}

      {admin && group && (
        <section className="panel stats-upload">
          <div className="panel-head"><div><h2>Upload a new image for {group.name}</h2>
            <p>It becomes {group.name}&apos;s current image for its JCs, the Saheb and you. The current one moves to {group.name}&apos;s history with its date. To upload for another Jamiat, choose it above. PNG, JPG, WebP or GIF, up to {MAX_MB} MB.</p></div></div>
          <div className="stats-upload-body">
            <label className="stats-drop">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => pick(e.target.files[0])} />
              {preview ? <img src={preview} alt="Selected image" /> : <span><UploadIcon /> Choose an image</span>}
            </label>
            <div className="stats-upload-side">
              {file && <p className="muted stats-file">{file.name} · {sizeOf(file.size)}</p>}
              <label className="field">
                <span className="field-label">Title (optional)</span>
                <input className="input" value={title} maxLength={150} placeholder="e.g. Stats for Jumadal Ukhra 1448" onChange={(e) => setTitle(e.target.value)} />
              </label>
              <div className="stats-upload-actions">
                <button type="button" className={`btn btn-primary${busy ? " loading" : ""}`} disabled={!file || busy} onClick={upload}><UploadIcon /> Upload</button>
                {file && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { pick(null); if (fileRef.current) fileRef.current.value = ""; }}>Cancel</button>}
              </div>
            </div>
          </div>
        </section>
      )}

      {!groups ? (!error && <div className="panel portal-empty">Loading…</div>) : !group ? null : !current ? (
        <section className="panel stats-empty"><ImageIcon /><p>{admin ? `No image for ${group.name} yet. Upload one above.` : `No stats have been shared for ${group.name} yet.`}</p></section>
      ) : (
        <>
          <section className="panel stats-current" aria-label="Current stats image">
            <header className="stats-head">
              <div>
                <span className="stats-tag">Current</span> <span className="stats-tag old">{group.name}</span>
                <h2>{name(current)}</h2>
                <p className="muted">Uploaded on <b>{fmtDate(current.uploadedAt)}</b> at {fmtTime(current.uploadedAt)}</p>
              </div>
              <div className="stats-head-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setView(0)}>View full size</button>
                {admin && <button type="button" className="icon-btn" title="Remove" aria-label="Remove the current image" disabled={busy} onClick={() => remove(current, 0)}><TrashIcon /></button>}
              </div>
            </header>
            <div className="stats-frame">
              <StatImg image={current} onStale={() => load()} alt={`${name(current)} (uploaded ${fmtDate(current.uploadedAt)})`} className="stats-main-img" onClick={() => setView(0)} />
            </div>
          </section>

          <section className="panel stats-history" aria-label="Earlier images">
            <div className="panel-head"><div><h2>History</h2>
              <p>{history.length ? `${history.length} earlier image${history.length > 1 ? "s" : ""}, newest first. Click one to see it full size.` : "No earlier images yet. When a new image is uploaded, this one will move here."}</p></div></div>
            {history.length > 0 && (
              <ol className="stats-grid">
                {history.map((s, n) => {
                  const i = n + 1;
                  return (
                    <li key={s.id} className="stats-card">
                      <div className="stats-thumb"><StatImg image={s} onStale={() => load()} alt={`${name(s)} (uploaded ${fmtDate(s.uploadedAt)})`} onClick={() => setView(i)} /></div>
                      <div className="stats-card-info">
                        <b>{name(s)}</b>
                        <span className="muted">Uploaded {fmtDate(s.uploadedAt)}</span>
                        <span className="muted">Shown until {fmtDate(until(i))}</span>
                      </div>
                      {admin && <button type="button" className="icon-btn" title="Remove" aria-label={`Remove the image uploaded ${fmtDate(s.uploadedAt)}`} disabled={busy} onClick={() => remove(s, i)}><TrashIcon /></button>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}

      {view >= 0 && list && list[view] && (
        <div className="stats-viewer" role="dialog" aria-modal="true" aria-label="Image full size" onClick={(e) => e.target === e.currentTarget && setView(-1)}>
          <div className="stats-viewer-bar">
            <div>
              <b>{name(list[view])}</b> {view === 0 ? <span className="stats-tag">Current</span> : <span className="stats-tag old">Earlier</span>}
              <div className="stats-viewer-date">Uploaded {fmtDate(list[view].uploadedAt)}, {fmtTime(list[view].uploadedAt)}{view > 0 && ` · shown until ${fmtDate(until(view))}`} · {list.length - view} of {list.length}</div>
            </div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setView(-1)}><CloseIcon /></button>
          </div>
          <div className="stats-viewer-body" onClick={(e) => e.target === e.currentTarget && setView(-1)}>
            <button type="button" className="stats-nav prev" aria-label="Older image" disabled={view >= list.length - 1} onClick={() => setView(view + 1)}><ChevronLeft size={22} /></button>
            <StatImg key={list[view].id} image={list[view]} onStale={() => load()} alt={`${name(list[view])} (uploaded ${fmtDate(list[view].uploadedAt)})`} className="stats-viewer-img" />
            <button type="button" className="stats-nav next" aria-label="Newer image" disabled={view <= 0} onClick={() => setView(view - 1)}><ChevronRight size={22} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
