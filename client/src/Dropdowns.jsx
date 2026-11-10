import { useCallback, useEffect, useState } from "react";
import { CheckIcon, ChevronLeft, ChevronRight, CloseIcon } from "./components/Icons";
import { AuthError, isServerStarting, listAdd, listEdit, listOrder, listRemove, listsGet } from "./lib/api";

// Super Admin: values of the dropdowns used on the JC portal (answers) and in the Jamaat master (Mauze Type).
export default function Dropdowns({ onAuthExpired }) {
  const [data, setData] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null);   // { key, id, value, meaning }
  const [drafts, setDrafts] = useState({}); // new value per list: { [key]: { value, meaning } }

  const load = useCallback(async (tries = 0) => {
    try {
      setData(await listsGet());
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setLoadMsg("Connecting to the server…");
        setTimeout(() => load(tries + 1), 5000);
      } else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);

  // Every change returns the fresh lists.
  const act = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      setData(await fn());
      setMsg({ type: "ok", text: okText });
      return true;
    } catch (err) {
      if (err instanceof AuthError) { onAuthExpired(); return false; }
      setMsg({ type: "error", text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="panel portal-empty" style={{ marginTop: 28 }}>{loadMsg}</div>;

  const meaningOf = (k) => data.meanings.find((m) => m.key === k);
  const draftOf = (key) => drafts[key] || { value: "", meaning: "" };
  const setDraft = (key, patch) => setDrafts((d) => ({ ...d, [key]: { ...draftOf(key), ...patch } }));

  const add = async (e, list) => {
    e.preventDefault();
    const d = draftOf(list.key);
    if (!d.value.trim()) return setMsg({ type: "error", text: "Enter the new value." });
    if (list.kind === "answers" && !d.meaning) return setMsg({ type: "error", text: "Choose what the new answer means." });
    if (await act(() => listAdd(list.key, d), `Added “${d.value.trim()}” to ${list.label}.`)) {
      setDrafts((x) => ({ ...x, [list.key]: { value: "", meaning: "" } }));
    }
  };

  const save = async (e, list) => {
    e.preventDefault();
    const old = list.values.find((v) => v.id === edit.id);
    const renamed = old && old.value !== edit.value.trim();
    if (renamed && old.inUse && !window.confirm(
      `Rename “${old.value}” to “${edit.value.trim()}”?\n\nIt is used ${old.inUse} time${old.inUse === 1 ? "" : "s"}; those will be renamed too.`)) return;
    const body = list.kind === "answers" ? { value: edit.value, meaning: edit.meaning } : { value: edit.value };
    if (await act(() => listEdit(list.key, edit.id, body), "Saved.")) setEdit(null);
  };

  const remove = (list, v) => {
    if (!window.confirm(`Remove “${v.value}” from ${list.label}?`)) return;
    act(() => listRemove(list.key, v.id), `Removed “${v.value}”.`);
  };

  const move = (list, i, dir) => {
    const ids = list.values.map((v) => v.id);
    const j = i + dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act(() => listOrder(list.key, ids), "Order saved.");
  };

  return (
    <>
      <section className="page-head">
        <div className="page-title">
          <h1>Dropdown values</h1>
          <p className="page-sub">The choices JCs pick from on the JC portal. Changes apply immediately.</p>
        </div>
      </section>

      {msg && (
        <div className={msg.type === "error" ? "alert" : "success"} role={msg.type === "error" ? "alert" : "status"}>
          {msg.type === "ok" && <CheckIcon />} <span>{msg.text}</span>
        </div>
      )}

      <div className="dd-grid">
        {data.lists.map((list) => {
          const answers = list.kind === "answers";
          const d = draftOf(list.key);
          return (
            <section className="panel dd-panel" key={list.key}>
              <div className="panel-head">
                <div>
                  <h2>{list.label}</h2>
                  <p>Used by: {list.usedBy.join(", ")}</p>
                </div>
              </div>

              {answers && (
                <div className="dd-preview" aria-label="Preview on the JC portal">
                  {list.values.map((v) => (
                    <span key={v.id} className={`pill ${meaningOf(v.meaning)?.tone || "na"}`}>{v.value}</span>
                  ))}
                </div>
              )}

              <form onSubmit={(e) => save(e, list)} className="table-wrap">
                <table className="master-table dd-table">
                  <thead>
                    <tr>
                      <th>Order</th><th>Value</th>{answers && <th>Meaning on the dashboard</th>}
                      <th title={answers ? "Saved answers using this value" : "Jamaats using this value"}>In use</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.values.map((v, i) => {
                      const editing = edit && edit.key === list.key && edit.id === v.id;
                      return (
                        <tr key={v.id} className={editing ? "edit-row" : ""}>
                          <td className="order-cell">
                            <button type="button" className="mini-btn icon" disabled={busy || i === 0} onClick={() => move(list, i, -1)} aria-label={`Move ${v.value} up`}>
                              <span className="rot"><ChevronLeft size={14} /></span>
                            </button>
                            <button type="button" className="mini-btn icon" disabled={busy || i === list.values.length - 1} onClick={() => move(list, i, 1)} aria-label={`Move ${v.value} down`}>
                              <span className="rot"><ChevronRight size={14} /></span>
                            </button>
                          </td>
                          <td>
                            {editing ? (
                              <input className="input" autoFocus value={edit.value} maxLength={40}
                                onChange={(e) => setEdit({ ...edit, value: e.target.value })} aria-label="Value" />
                            ) : <span className="jm-name">{v.value}</span>}
                          </td>
                          {answers && (
                            <td>
                              {editing ? (
                                <select value={edit.meaning} onChange={(e) => setEdit({ ...edit, meaning: e.target.value })} aria-label="Meaning">
                                  {data.meanings.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                                </select>
                              ) : (
                                <span className="meaning"><span className={`dot tone-${meaningOf(v.meaning)?.tone || "na"}`} />{meaningOf(v.meaning)?.label || "—"}</span>
                              )}
                            </td>
                          )}
                          <td className="tnum">{v.inUse}</td>
                          <td className="row-actions">
                            {editing ? (
                              <>
                                <button type="submit" className="mini-btn primary" disabled={busy}><CheckIcon /> Save</button>
                                <button type="button" className="mini-btn" onClick={() => setEdit(null)} title="Cancel"><CloseIcon /></button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="mini-btn" disabled={busy}
                                  onClick={() => { setEdit({ key: list.key, id: v.id, value: v.value, meaning: v.meaning }); setMsg(null); }}>Edit</button>
                                <button type="button" className="mini-btn danger" disabled={busy || v.inUse > 0} onClick={() => remove(list, v)}
                                  title={v.inUse ? "In use: rename it instead" : "Remove"}>Remove</button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </form>

              <form className="add-line dd-add" onSubmit={(e) => add(e, list)}>
                <input className="input" placeholder={answers ? "New answer, e.g. Partly done" : "New Mauze Type"} value={d.value} maxLength={40}
                  onChange={(e) => setDraft(list.key, { value: e.target.value })} aria-label={`New value for ${list.label}`} />
                {answers && (
                  <select value={d.meaning} onChange={(e) => setDraft(list.key, { meaning: e.target.value })} aria-label="Meaning of the new answer">
                    <option value="">Meaning…</option>
                    {data.meanings.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                )}
                <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
              </form>
            </section>
          );
        })}
      </div>

      <p className="dd-note">
        <b>Meaning</b> decides the colour on the dashboard and the completion rate: <i>Done</i> counts as done,
        <i> Not applicable</i> is left out, everything else counts as not done yet.
        A value that is in use can't be removed; renaming it also renames it in all saved entries.
      </p>
    </>
  );
}
