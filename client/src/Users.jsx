import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Notice from "./components/Notice";
import MultiSelect from "./components/MultiSelect";
import { AuthError, createUser, deleteUser, isServerStarting, mastersList, updateUser, usersList } from "./lib/api";
import { lower, plural } from "./lib/helpers";

// Quick check in the browser; the server does the full Gmail check.
const looksLikeGmail = (v) => /^[^\s@]+@(gmail|googlemail)\.com$/i.test(v.trim());
const fmtDate = (d) => new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const ROLES = [
  { key: "jc", label: "JC", hint: "Fills the JC portal for the Jamiats / Jamaats assigned below" },
  { key: "saheb", label: "Saheb", hint: "Sees the Sahebo dashboard" },
  { key: "superadmin", label: "Super Admin", hint: "Manages users, masters and portal fields" },
];
const roleLabel = (k) => (ROLES.find((r) => r.key === k) || { label: k }).label;

// Super Admin: every user = a Gmail address + a role (JCs also get Jamiats / Jamaats).
// They sign in with that Google account.
export default function Users({ onAuthExpired }) {
  const [users, setUsers] = useState(null);
  const [me, setMe] = useState("");
  const [masters, setMasters] = useState(null);
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [form, setForm] = useState(null); // { id: "" (new) | userId, email, role, jamiats, jamaats }
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const formRef = useRef(null);

  const load = useCallback(async (tries = 0) => {
    try {
      const [u, m] = await Promise.all([usersList(), mastersList()]);
      setUsers(u.users);
      setMe(u.me);
      setMasters(m);
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setLoadMsg("Connecting to the server…");
        setTimeout(() => load(tries + 1), 5000);
      } else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);

  // Active Jamiats / Jamaats are what can be assigned.
  const active = useMemo(() => {
    if (!masters) return null;
    const jamiats = masters.jamiats.filter((j) => j.isActive);
    const jamiatName = new Map(jamiats.map((j) => [j.id, j.name]));
    const jamaats = masters.jamaats.filter((jm) => jm.isActive && jamiatName.has(jm.jamiatId));
    const jamaatsOf = new Map(jamiats.map((j) => [j.id, []]));
    for (const jm of jamaats) jamaatsOf.get(jm.jamiatId).push(jm);
    return { jamiats, jamaats, jamiatName, jamaatsOf };
  }, [masters]);

  const allAccess = useCallback(() => ({
    jamiats: active.jamiats.map((j) => j.id),  // by default everything is selected
    jamaats: active.jamaats.map((jm) => jm.id),
  }), [active]);
  const newForm = useCallback(() => ({ id: "", email: "", role: "jc", ...allAccess() }), [allAccess]);

  useEffect(() => { if (active && !form) setForm(newForm()); }, [active, form, newForm]);

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

  if (!users || !active || !form) return <div className="panel portal-empty" style={{ marginTop: 28 }}>{loadMsg}</div>;

  // Jamiat choice changed: a newly ticked Jamiat brings all its Jamaats; an unticked one takes its Jamaats away.
  const setJamiats = (next) => {
    const added = next.filter((id) => !form.jamiats.includes(id));
    const keep = form.jamaats.filter((jmId) => {
      const jm = active.jamaats.find((x) => x.id === jmId);
      return !jm || next.includes(jm.jamiatId);
    });
    const extra = added.flatMap((id) => (active.jamaatsOf.get(id) || []).map((jm) => jm.id));
    setForm({ ...form, jamiats: next, jamaats: [...new Set([...keep, ...extra])] });
  };

  const jamaatOptions = active.jamaats
    .filter((jm) => form.jamiats.includes(jm.jamiatId))
    .map((jm) => ({ value: jm.id, label: jm.name, group: active.jamiatName.get(jm.jamiatId) }));

  const editing = form.id ? users.find((u) => u.id === form.id) : null;
  const isJc = form.role === "jc";

  const submit = async (e) => {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!looksLikeGmail(email)) return setMsg({ type: "error", text: "Enter a Gmail address (ending in @gmail.com)." });
    const body = { email, role: form.role };

    if (isJc) {
      if (!form.jamiats.length) return setMsg({ type: "error", text: "Choose at least one Jamiat." });
      const empty = form.jamiats.filter((id) => (active.jamaatsOf.get(id) || []).length && !(active.jamaatsOf.get(id) || []).some((jm) => form.jamaats.includes(jm.id)));
      if (empty.length) return setMsg({ type: "error", text: `Choose at least one Jamaat in ${empty.map((id) => active.jamiatName.get(id)).join(", ")}.` });

      // Keep assignments the picker can't show (inactive Jamiats / Jamaats) when editing.
      let jamiats = form.jamiats;
      let jamaats = form.jamaats;
      if (editing && editing.role === "jc") {
        jamiats = [...jamiats, ...editing.jamiats.filter((id) => !active.jamiatName.has(id))];
        const jamiatOfAll = new Map(masters.jamaats.map((jm) => [jm.id, jm.jamiatId]));
        const hiddenJamaats = editing.jamaats.filter((id) => !active.jamaats.some((jm) => jm.id === id));
        jamaats = [...jamaats, ...hiddenJamaats.filter((id) => jamiats.includes(jamiatOfAll.get(id)))];
      }
      body.jamiats = jamiats;
      body.jamaats = jamaats;
    }

    if (editing && editing.role !== form.role &&
      !window.confirm(`Change ${editing.email || editing.username} from ${roleLabel(editing.role)} to ${roleLabel(form.role)}?\n\nThey will be signed out and see the ${roleLabel(form.role)} pages next time.`)) return;

    const ok = editing
      ? await act(() => updateUser(editing.id, body), `Saved ${email}.`)
      : await act(() => createUser(body), `Added ${email} as ${roleLabel(form.role)}.`);
    if (ok) setForm(newForm());
  };

  const startEdit = (u) => {
    const access = u.role === "jc"
      ? {
          jamiats: u.jamiats.filter((id) => active.jamiatName.has(id)),
          jamaats: u.jamaats.filter((id) => active.jamaats.some((jm) => jm.id === id)),
        }
      : allAccess(); // if the role is changed to JC, start from All
    setForm({ id: u.id, email: u.email, role: u.role, ...access });
    setMsg(null);
    formRef.current && formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const who = (u) => u.email || u.username;
  const toggle = (u) => {
    if (u.isActive && !window.confirm(`Deactivate ${who(u)}?\n\nThey will be signed out and can't sign in until activated again.`)) return;
    act(() => updateUser(u.id, { isActive: !u.isActive }), `${who(u)} is now ${u.isActive ? "inactive" : "active"}.`);
  };
  const remove = (u) => {
    if (!window.confirm(`Delete ${who(u)}? This cannot be undone.`)) return;
    act(() => deleteUser(u.id), `Deleted ${who(u)}.`).then((ok) => ok && form.id === u.id && setForm(newForm()));
  };

  // "All Jamiats · All Jamaats" / "AHMEDABAD · 12 of 26 Jamaats" / "3 Jamiats · 40 Jamaats"
  const accessText = (u) => {
    if (u.role !== "jc") return { text: "—", title: "" };
    const jIds = u.jamiats.filter((id) => active.jamiatName.has(id));
    const mIds = u.jamaats.filter((id) => active.jamaats.some((jm) => jm.id === id && jIds.includes(jm.jamiatId)));
    const possible = jIds.reduce((n, id) => n + (active.jamaatsOf.get(id) || []).length, 0);
    const jamiatPart = jIds.length === active.jamiats.length ? "All Jamiats"
      : jIds.length === 1 ? active.jamiatName.get(jIds[0]) : plural(jIds.length, "Jamiat");
    const jamaatPart = mIds.length === possible ? (jIds.length === active.jamiats.length ? "All Jamaats" : `all ${possible} Jamaats`)
      : `${mIds.length} of ${possible} Jamaats`;
    return { text: `${jamiatPart} · ${jamaatPart}`, title: jIds.map((id) => active.jamiatName.get(id)).join(", ") };
  };

  const q = lower(query);
  const shown = users.filter((u) => (!roleFilter || u.role === roleFilter) && (!q || lower(u.email).includes(q) || lower(u.name).includes(q) || lower(u.username).includes(q)));
  const countOf = (r) => users.filter((u) => u.role === r).length;

  return (
    <>
      <section className="page-head">
        <div className="page-title">
          <h1>Users</h1>
          <p className="page-sub">Everyone signs in with Google. Only the Gmail addresses listed here can sign in. {plural(countOf("jc"), "JC")} · {plural(countOf("saheb"), "Saheb")} · {plural(countOf("superadmin"), "Super Admin")}.</p>
        </div>
      </section>

      {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}

      <div className="panel" ref={formRef}>
        <div className="panel-head">
          <div>
            <h2>{editing ? `Edit ${who(editing)}` : "Add a user"}</h2>
            <p>{(ROLES.find((r) => r.key === form.role) || {}).hint}</p>
          </div>
        </div>
        <form className={`user-form${isJc ? "" : " no-access"}`} onSubmit={submit}>
          <label className="field">
            <span className="field-label">Gmail address</span>
            <input className="input" type="email" inputMode="email" autoComplete="off" placeholder="name@gmail.com"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={120} />
          </label>
          <label className="field">
            <span className="field-label">Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              disabled={editing && editing.id === me} title={editing && editing.id === me ? "You can't change your own role" : ""}>
              {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          {isJc && (
            <>
              <MultiSelect label="Jamiats" noun="Jamiat"
                options={active.jamiats.map((j) => ({ value: j.id, label: j.name }))}
                selected={form.jamiats} onChange={setJamiats} />
              <MultiSelect label="Jamaats" noun="Jamaat" emptyText="Choose a Jamiat first"
                options={jamaatOptions}
                selected={form.jamaats} onChange={(v) => setForm({ ...form, jamaats: v })} />
            </>
          )}
          <div className="user-form-actions">
            {editing && <button type="button" className="btn btn-ghost" onClick={() => setForm(newForm())}>Cancel</button>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{editing ? "Save changes" : "Add user"}</button>
          </div>
        </form>
      </div>

      <div className="panel users-list">
        <div className="add-line users-tools">
          <input className="input" type="search" placeholder="Search Gmail or name…" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
          <select className="role-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table className="master-table users-table">
            <thead>
              <tr><th>#</th><th>Gmail</th><th>Role</th><th>Assigned</th><th>Status</th><th>Last sign-in</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((u, i) => {
                const a = accessText(u);
                const self = u.id === me;
                return (
                  <tr key={u.id} className={`${u.isActive ? "" : "is-off"}${form.id === u.id ? " edit-row" : ""}`}>
                    <td className="idx">{i + 1}</td>
                    <td>
                      {u.email ? <span className="jm-name">{u.email}</span> : (
                        <span className="no-gmail">No Gmail yet ({u.username}) — <b>can't sign in</b>. Click Edit to add one.</span>
                      )}
                      {u.name && <small className="user-sub">{u.name}</small>}
                      {self && <small className="user-sub">(you)</small>}
                    </td>
                    <td><span className={`pill role-${u.role}`}>{roleLabel(u.role)}</span></td>
                    <td className="access" title={a.title}>{a.text}</td>
                    <td>{u.isActive ? <span className="pill good">Active</span> : <span className="pill na">Inactive</span>}</td>
                    <td className="muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</td>
                    <td className="row-actions">
                      <button type="button" className="mini-btn" onClick={() => startEdit(u)} disabled={busy}>Edit</button>
                      <button type="button" className="mini-btn" onClick={() => toggle(u)} disabled={busy || self}
                        title={self ? "You can't deactivate yourself" : ""}>{u.isActive ? "Deactivate" : "Activate"}</button>
                      <button type="button" className="mini-btn danger" onClick={() => remove(u)} disabled={busy || self}
                        title={self ? "You can't delete yourself" : ""}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <div className="empty-state">{users.length ? "No user matches." : "No users yet."}</div>}
        </div>
      </div>
    </>
  );
}
