import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, CloseIcon } from "./components/Icons";
import Notice from "./components/Notice";
import {
  AuthError, createJamaat, createJamiat, deleteJamaat, deleteJamiat, isServerStarting,
  allAccessCount, grantAllAccess, mastersList, restoreJamaat, restoreJamiat, updateJamaat, updateJamiat,
} from "./lib/api";
import { deletedLine, lower, plural } from "./lib/helpers";

const cleanName = (v) => v.replace(/\s+/g, " ").trim().toUpperCase();
const emptyJamaat = { name: "", mauzeType: "", houseCount: "", children: "" };
const toForm = (jm) => ({
  jamiatId: jm.jamiatId,
  name: jm.name,
  mauzeType: jm.mauzeType,
  houseCount: jm.houseCount == null ? "" : String(jm.houseCount),
  children: jm.children == null ? "" : String(jm.children),
});

// Jamiat / Jamaat masters (a section of the Super Admin portal).
export default function Masters({ onAuthExpired }) {
  const [data, setData] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [selectedId, setSelectedId] = useState("");
  const [jamiatQuery, setJamiatQuery] = useState("");
  const [jamaatQuery, setJamaatQuery] = useState("");
  const [newJamiat, setNewJamiat] = useState("");
  const [renaming, setRenaming] = useState(null);  // new name while renaming the selected Jamiat
  const [editId, setEditId] = useState("");        // Jamaat being edited ("new" = adding)
  const [edit, setEdit] = useState(emptyJamaat);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);            // { type: "error" | "ok", text }
  const [showDeleted, setShowDeleted] = useState(false); // also list records with status "D"

  const load = useCallback(async (tries = 0) => {
    try {
      const d = await mastersList();
      setData(d);
      const first = d.jamiats.find((j) => !j.deleted);
      setSelectedId((id) => (id && d.jamiats.some((j) => j.id === id) ? id : first ? first.id : ""));
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setLoadMsg("Connecting to the server…");
        setTimeout(() => load(tries + 1), 5000);
      } else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);

  // Runs a change, shows the result, reloads the lists.
  const act = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      await load();
      setMsg({ type: "ok", text: okText });
      return res || true;
    } catch (err) {
      if (err instanceof AuthError) { onAuthExpired(); return false; }
      setMsg({ type: "error", text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // After adding a Jamiat / Jamaat: offer it to the JCs who had access to everything until now.
  const offerAccess = async (type, id, name, everything) => {
    try {
      const { count } = await allAccessCount(type, id);
      if (!count) return;
      if (!window.confirm(`${plural(count, "JC")} currently ${count === 1 ? "has" : "have"} access to ${everything}.\n\nGive ${count === 1 ? "this JC" : "them"} access to ${name} too?`)) return;
      const r = await grantAllAccess(type, id);
      setMsg({ type: "ok", text: `Added ${name}. ${plural(r.updated, "JC")} now ${r.updated === 1 ? "has" : "have"} access to it.` });
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      setMsg({ type: "error", text: `Added ${name}, but could not update JC access: ${err.message}` });
    }
  };

  const counts = useMemo(() => {
    const m = new Map();
    for (const jm of data ? data.jamaats : []) if (!jm.deleted) m.set(jm.jamiatId, (m.get(jm.jamiatId) || 0) + 1);
    return m;
  }, [data]);

  if (!data) {
    return <div className="panel portal-empty" style={{ marginTop: 28 }}>{loadMsg}</div>;
  }

  const selected = data.jamiats.find((j) => j.id === selectedId && (showDeleted || !j.deleted)) || null;
  const jq = lower(jamiatQuery);
  const visible = (x) => showDeleted || !x.deleted;
  const liveJamiats = data.jamiats.filter((j) => !j.deleted);
  const liveJamaats = data.jamaats.filter((jm) => !jm.deleted);
  const deletedCount = data.jamiats.length - liveJamiats.length + data.jamaats.length - liveJamaats.length;
  const jamiatRows = data.jamiats.filter((j) => visible(j) && (!jq || lower(j.name).includes(jq)));
  const allInJamiat = selected ? data.jamaats.filter((jm) => jm.jamiatId === selected.id && visible(jm)) : [];
  const liveInJamiat = allInJamiat.filter((jm) => !jm.deleted);
  const mq = lower(jamaatQuery);
  const jamaatRows = allInJamiat.filter((jm) => !mq || lower(jm.name).includes(mq));

  const addJamiat = async (e) => {
    e.preventDefault();
    const name = cleanName(newJamiat);
    if (name.length < 2) return setMsg({ type: "error", text: "Enter the Jamiat name." });
    const res = await act(() => createJamiat({ name }), `Added Jamiat ${name}.`);
    if (res) { setNewJamiat(""); setSelectedId(res.jamiat.id); await offerAccess("jamiat", res.jamiat.id, name, "all Jamiats"); }
  };

  const saveRename = async (e) => {
    e.preventDefault();
    const name = cleanName(renaming || "");
    if (name === selected.name) return setRenaming(null);
    if (await act(() => updateJamiat(selected.id, { name }), `Renamed to ${name}.`)) setRenaming(null);
  };

  const toggleJamiat = () => {
    const to = !selected.isActive;
    if (!to && !window.confirm(`Mark ${selected.name} inactive?\n\nIt and its Jamaats will be hidden from the JC portal and the dashboard. Saved entries are kept.`)) return;
    act(() => updateJamiat(selected.id, { isActive: to }), `${selected.name} is now ${to ? "active" : "inactive"}.`);
  };

  const removeJamiat = () => {
    if (!window.confirm(`Delete the Jamiat ${selected.name}?\n\nIt will get status D (deleted): hidden everywhere and taken away from JCs. Nothing is erased; you can restore it from “Show deleted”.`)) return;
    act(() => deleteJamiat(selected.id), `Deleted ${selected.name} (status D). Tick “Show deleted” to restore it.`).then((ok) => ok && !showDeleted && setSelectedId(""));
  };
  const restoreJamiatNow = () => act(() => restoreJamiat(selected.id), `Restored ${selected.name}.`);

  const startAdd = () => { setEditId("new"); setEdit({ ...emptyJamaat, jamiatId: selected.id }); setMsg(null); };
  const startEdit = (jm) => { setEditId(jm.id); setEdit(toForm(jm)); setMsg(null); };
  const cancelEdit = () => { setEditId(""); setEdit(emptyJamaat); };

  const saveJamaat = async (e) => {
    e.preventDefault();
    const name = cleanName(edit.name);
    if (name.length < 2) return setMsg({ type: "error", text: "Enter the Jamaat name." });
    const body = { name, mauzeType: edit.mauzeType, houseCount: edit.houseCount, children: edit.children };
    const ok = editId === "new"
      ? await act(() => createJamaat({ ...body, jamiatId: selected.id }), `Added Jamaat ${name}.`)
      : await act(() => updateJamaat(editId, { ...body, jamiatId: edit.jamiatId }), `Saved ${name}.`);
    if (ok) cancelEdit();
    if (ok && editId === "new" && ok.jamaat) await offerAccess("jamaat", ok.jamaat.id, name, `all Jamaats of ${selected.name}`);
  };

  const toggleJamaat = (jm) => {
    const to = !jm.isActive;
    if (!to && !window.confirm(`Mark ${jm.name} inactive?\n\nIt will be hidden from the JC portal and the dashboard. Saved entries are kept.`)) return;
    act(() => updateJamaat(jm.id, { isActive: to }), `${jm.name} is now ${to ? "active" : "inactive"}.`);
  };

  const removeJamaat = (jm) => {
    if (!window.confirm(`Delete the Jamaat ${jm.name}?\n\nIt will get status D (deleted): hidden everywhere and taken away from JCs. Nothing is erased; you can restore it from “Show deleted”.`)) return;
    act(() => deleteJamaat(jm.id), `Deleted ${jm.name} (status D). Tick “Show deleted” to restore it.`);
  };
  const restoreJamaatNow = (jm) => act(() => restoreJamaat(jm.id), `Restored ${jm.name}. Give JCs access to it again in Users if needed.`);

  const editRow = (key) => (
    <tr className="edit-row" key={key}>
      <td className="idx">{editId === "new" ? "+" : ""}</td>
      <td className="cell-main" data-label={editId === "new" ? "New Jamaat" : "Jamaat"}>
        <input className="input" autoFocus placeholder="Jamaat name" value={edit.name} maxLength={120}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Jamaat name" />
        {editId !== "new" && (
          <select className="move-select" value={edit.jamiatId} onChange={(e) => setEdit({ ...edit, jamiatId: e.target.value })} aria-label="Jamiat">
            {liveJamiats.map((j) => <option key={j.id} value={j.id}>{j.id === selected.id ? `Jamiat: ${j.name}` : `Move to ${j.name}`}</option>)}
          </select>
        )}
      </td>
      <td data-label="Mauze Type">
        <select value={edit.mauzeType} onChange={(e) => setEdit({ ...edit, mauzeType: e.target.value })} aria-label="Mauze Type">
          <option value="">Not set</option>
          {data.mauzeTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td data-label="House Count"><input className="input num" type="number" min="0" step="1" value={edit.houseCount} onChange={(e) => setEdit({ ...edit, houseCount: e.target.value })} aria-label="House Count" /></td>
      <td data-label="Children"><input className="input num" type="number" min="0" step="1" value={edit.children} onChange={(e) => setEdit({ ...edit, children: e.target.value })} aria-label="Children" /></td>
      <td colSpan={2} />
      <td className="row-actions">
        <button type="submit" className="mini-btn primary" disabled={busy} title="Save"><CheckIcon /> Save</button>
        <button type="button" className="mini-btn" onClick={cancelEdit} title="Cancel"><CloseIcon /></button>
      </td>
    </tr>
  );

  return (
    <>
        <section className="page-head">
          <div className="page-title">
            <h1>Masters</h1>
            <p className="page-sub">Jamiat and Jamaat lists used by the JC portal and the dashboard. {plural(liveJamiats.length, "Jamiat")} · {plural(liveJamaats.length, "Jamaat")}.</p>
          </div>
          <label className="check show-deleted">
            <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted ({deletedCount})
          </label>
        </section>

        {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}

        <section className="masters-layout">
          {/* ---- Jamiats ---- */}
          <aside className="panel">
            <div className="panel-head"><div><h2>Jamiats</h2><p>Click a Jamiat to see its Jamaats.</p></div></div>
            <form className="add-line" onSubmit={addJamiat}>
              <input className="input" placeholder="New Jamiat name" value={newJamiat} maxLength={80}
                onChange={(e) => setNewJamiat(e.target.value)} aria-label="New Jamiat name" />
              <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
            </form>
            <div className="add-line">
              <input className="input" type="search" placeholder="Search Jamiats…" value={jamiatQuery}
                onChange={(e) => setJamiatQuery(e.target.value)} aria-label="Search Jamiats" />
            </div>
            <div className="side-body master-list">
              {jamiatRows.map((j) => (
                <button type="button" key={j.id} className={`master-row${j.id === selectedId ? " is-sel" : ""}${j.isActive ? "" : " is-off"}${j.deleted ? " is-deleted" : ""}`}
                  onClick={() => { setSelectedId(j.id); setRenaming(null); cancelEdit(); setJamaatQuery(""); }}>
                  <span className="rank-name">{j.name}</span>
                  {j.deleted ? <span className="pill bad">Deleted</span> : !j.isActive && <span className="pill na">Inactive</span>}
                  <span className="master-count">{counts.get(j.id) || 0}</span>
                </button>
              ))}
              {!jamiatRows.length && <div className="empty-state">No Jamiat matches.</div>}
            </div>
          </aside>

          {/* ---- Jamaats of the selected Jamiat ---- */}
          <div className="panel">
            {!selected ? (
              <div className="empty-state">Add or choose a Jamiat.</div>
            ) : (
              <>
                <div className="panel-head master-head">
                  {renaming == null ? (
                    <div>
                      <h2>{selected.name} {selected.deleted ? <span className="pill bad">Deleted (status D)</span> : !selected.isActive && <span className="pill na">Inactive</span>}</h2>
                      <p>{selected.deleted ? deletedLine(selected) : plural(liveInJamiat.length, "Jamaat")}</p>
                    </div>
                  ) : (
                    <form className="rename-form" onSubmit={saveRename}>
                      <input className="input" autoFocus value={renaming} maxLength={80} onChange={(e) => setRenaming(e.target.value)} aria-label="Jamiat name" />
                      <button type="submit" className="mini-btn primary" disabled={busy}><CheckIcon /> Save</button>
                      <button type="button" className="mini-btn" onClick={() => setRenaming(null)}><CloseIcon /></button>
                    </form>
                  )}
                  <div className="head-actions">
                    {selected.deleted ? (
                      <button type="button" className="mini-btn primary" onClick={restoreJamiatNow} disabled={busy}>Restore</button>
                    ) : (
                      <>
                        {renaming == null && <button type="button" className="mini-btn" onClick={() => setRenaming(selected.name)}>Rename</button>}
                        <button type="button" className="mini-btn" onClick={toggleJamiat} disabled={busy}>{selected.isActive ? "Mark inactive" : "Mark active"}</button>
                        <button type="button" className="mini-btn danger" onClick={removeJamiat} disabled={busy}>Delete</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="add-line jamaat-tools">
                  <input className="input" type="search" placeholder={`Search Jamaats in ${selected.name}…`} value={jamaatQuery}
                    onChange={(e) => setJamaatQuery(e.target.value)} aria-label="Search Jamaats" />
                  <button type="button" className="btn btn-primary" onClick={startAdd} disabled={editId === "new" || selected.deleted}
                    title={selected.deleted ? "Restore the Jamiat first" : ""}>Add Jamaat</button>
                </div>

                <form onSubmit={saveJamaat} className="table-wrap">
                  <table className="master-table card-rows">
                    <thead>
                      <tr>
                        <th>#</th><th>Jamaat</th><th>Mauze Type</th><th>House Count</th><th>Children</th>
                        <th>Status</th><th title="Monthly entries saved">Entries</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {editId === "new" && editRow("new")}
                      {jamaatRows.map((jm, i) =>
                        jm.id === editId ? editRow(jm.id) : (
                          <tr key={jm.id} className={`${jm.isActive ? "" : "is-off"}${jm.deleted ? " is-deleted" : ""}`}>
                            <td className="idx">{i + 1}</td>
                            <td className="jm-name cell-main">{jm.name}</td>
                            <td data-label="Mauze Type">{jm.mauzeType || <span className="muted">—</span>}</td>
                            <td className="tnum" data-label="House Count">{jm.houseCount ?? <span className="muted">—</span>}</td>
                            <td className="tnum" data-label="Children">{jm.children ?? <span className="muted">—</span>}</td>
                            <td data-label="Status">{jm.deleted ? <span className="pill bad" title={deletedLine(jm)}>Deleted (D)</span> : jm.isActive ? <span className="pill good">Active</span> : <span className="pill na">Inactive</span>}</td>
                            <td className="tnum" data-label="Entries">{jm.entryCount}</td>
                            <td className="row-actions">
                              {jm.deleted ? (
                                <button type="button" className="mini-btn primary" onClick={() => restoreJamaatNow(jm)} disabled={busy || selected.deleted}
                                  title={selected.deleted ? "Restore the Jamiat first" : deletedLine(jm)}>Restore</button>
                              ) : <>
                              <button type="button" className="mini-btn" onClick={() => startEdit(jm)} disabled={busy}>Edit</button>
                              <button type="button" className="mini-btn" onClick={() => toggleJamaat(jm)} disabled={busy}>{jm.isActive ? "Deactivate" : "Activate"}</button>
                              <button type="button" className="mini-btn danger" onClick={() => removeJamaat(jm)} disabled={busy || jm.entryCount > 0}
                                title={jm.entryCount ? "Has monthly entries: deactivate instead" : "Delete"}>Delete</button>
                              </>}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                  {!jamaatRows.length && editId !== "new" && (
                    <div className="empty-state">{allInJamiat.length ? "No Jamaat matches." : "No Jamaats yet. Click “Add Jamaat”."}</div>
                  )}
                </form>
              </>
            )}
          </div>
        </section>
    </>
  );
}
