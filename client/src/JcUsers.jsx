import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CloseIcon } from "./components/Icons";
import { AuthError, createUser, deleteUser, isServerStarting, updateUser, usersList } from "./lib/api";
import { lower, plural } from "./lib/helpers";

// Quick check in the browser; the server does the full Gmail check.
const looksLikeGmail = (v) => /^[^\s@]+@(gmail|googlemail)\.com$/i.test(v.trim());
const fmtDate = (d) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

// Super Admin: JC users are added by Gmail address only.
export default function JcUsers({ onAuthExpired }) {
  const [users, setUsers] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [email, setEmail] = useState("");
  const [query, setQuery] = useState("");
  const [editId, setEditId] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async (tries = 0) => {
    try {
      setUsers((await usersList()).users);
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setLoadMsg("Connecting to the server…");
        setTimeout(() => load(tries + 1), 5000);
      } else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
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

  const add = async (e) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!looksLikeGmail(v)) return setMsg({ type: "error", text: "Enter a Gmail address (ending in @gmail.com)." });
    if (await act(() => createUser(v), `Added ${v}.`)) setEmail("");
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const v = editEmail.trim().toLowerCase();
    if (!looksLikeGmail(v)) return setMsg({ type: "error", text: "Enter a Gmail address (ending in @gmail.com)." });
    if (await act(() => updateUser(editId, { email: v }), `Saved ${v}.`)) setEditId("");
  };

  const toggle = (u) => {
    if (u.isActive && !window.confirm(`Deactivate ${u.email}?\n\nThey will not be able to use the JC portal once JC sign-in is switched on.`)) return;
    act(() => updateUser(u.id, { isActive: !u.isActive }), `${u.email} is now ${u.isActive ? "inactive" : "active"}.`);
  };

  const remove = (u) => {
    if (!window.confirm(`Delete ${u.email}? This cannot be undone.`)) return;
    act(() => deleteUser(u.id), `Deleted ${u.email}.`);
  };

  if (!users) return <div className="panel portal-empty" style={{ marginTop: 28 }}>{loadMsg}</div>;

  const q = lower(query);
  const shown = users.filter((u) => !q || u.email.includes(q));
  const active = users.filter((u) => u.isActive).length;

  return (
    <>
      <section className="page-head">
        <div className="page-title">
          <h1>JC Users</h1>
          <p className="page-sub">Jamaat Coordinators are added by their Gmail address. {plural(users.length, "user")} · {active} active.</p>
        </div>
      </section>

      {msg && (
        <div className={msg.type === "error" ? "alert" : "success"} role={msg.type === "error" ? "alert" : "status"}>
          {msg.type === "ok" && <CheckIcon />} <span>{msg.text}</span>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><div><h2>Add a JC</h2><p>Only the Gmail address is needed.</p></div></div>
        <form className="add-line users-add" onSubmit={add}>
          <input className="input" type="email" inputMode="email" autoComplete="off" placeholder="name@gmail.com"
            value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Gmail address" maxLength={120} />
          <button type="submit" className="btn btn-primary" disabled={busy}>Add JC</button>
        </form>

        <div className="add-line users-tools">
          <input className="input" type="search" placeholder="Search Gmail…" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
        </div>

        <form onSubmit={saveEdit} className="table-wrap">
          <table className="master-table users-table">
            <thead>
              <tr><th>#</th><th>Gmail</th><th>Status</th><th>Added</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((u, i) =>
                u.id === editId ? (
                  <tr className="edit-row" key={u.id}>
                    <td className="idx">{i + 1}</td>
                    <td colSpan={3}>
                      <input className="input" type="email" autoFocus value={editEmail} maxLength={120}
                        onChange={(e) => setEditEmail(e.target.value)} aria-label="Gmail address" />
                    </td>
                    <td className="row-actions">
                      <button type="submit" className="mini-btn primary" disabled={busy}><CheckIcon /> Save</button>
                      <button type="button" className="mini-btn" onClick={() => setEditId("")} title="Cancel"><CloseIcon /></button>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id} className={u.isActive ? "" : "is-off"}>
                    <td className="idx">{i + 1}</td>
                    <td className="jm-name">{u.email}</td>
                    <td>{u.isActive ? <span className="pill good">Active</span> : <span className="pill na">Inactive</span>}</td>
                    <td className="muted">{fmtDate(u.createdAt)}</td>
                    <td className="row-actions">
                      <button type="button" className="mini-btn" onClick={() => { setEditId(u.id); setEditEmail(u.email); setMsg(null); }} disabled={busy}>Edit</button>
                      <button type="button" className="mini-btn" onClick={() => toggle(u)} disabled={busy}>{u.isActive ? "Deactivate" : "Activate"}</button>
                      <button type="button" className="mini-btn danger" onClick={() => remove(u)} disabled={busy}>Delete</button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          {!shown.length && <div className="empty-state">{users.length ? "No Gmail matches." : "No JC users yet. Add the first Gmail above."}</div>}
        </form>
      </div>
    </>
  );
}
