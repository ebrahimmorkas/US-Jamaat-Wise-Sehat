import { useCallback, useEffect, useState } from "react";
import Notice from "./components/Notice";
import { CheckIcon, ChevronLeft, ChevronRight, CloseIcon } from "./components/Icons";
import {
  AuthError, fieldCreate, fieldDelete, fieldUpdate, fieldsGet, fieldsOrder, isServerStarting,
  listAdd, listEdit, listOrder, listRemove, listsGet, optionAdd, optionEdit, optionRemove, optionsOrder,
} from "./lib/api";
import { plural } from "./lib/helpers";

const MAUZE = "__mauze";
const PRESETS = {
  "Yes / No": [["Yes", "done"], ["No", "notdone"], ["Pending", "pending"], ["Not Applicable", "na"]],
  Progress: [["Completed", "done"], ["Pending", "pending"], ["In Progress", "progress"], ["Not Applicable", "na"]],
};
const blankNew = () => ({ label: "", section: "", type: "select", hasComment: true, required: true, showOnDashboard: true, options: [{ value: "", meaning: "" }, { value: "", meaning: "" }] });

// Super Admin: the dropdown questions of the JC portal, each with its own answers, plus the Mauze Type list.
export default function PortalFields({ onAuthExpired }) {
  const [data, setData] = useState(null);     // { fields, meanings }
  const [lists, setLists] = useState(null);   // { lists: [mauzeType] }
  const [loadMsg, setLoadMsg] = useState("Loading…");
  const [selected, setSelected] = useState(""); // field id | "new" | MAUZE
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async (tries = 0) => {
    try {
      const [f, l] = await Promise.all([fieldsGet(), listsGet()]);
      setData(f);
      setLists(l);
      setSelected((s) => s || (f.fields[0] ? f.fields[0].id : "new"));
    } catch (err) {
      if (err instanceof AuthError) return onAuthExpired();
      if (isServerStarting(err) && tries < 24) {
        setLoadMsg("Connecting to the server…");
        setTimeout(() => load(tries + 1), 5000);
      } else setLoadMsg(err.message);
    }
  }, [onAuthExpired]);
  useEffect(() => { load(); }, [load]);

  // Runs a change; every API call returns the fresh data.
  const act = async (fn, okText, target = "fields") => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      if (target === "fields") setData(res); else setLists(res);
      setMsg({ type: "ok", text: okText });
      return res;
    } catch (err) {
      if (err instanceof AuthError) { onAuthExpired(); return null; }
      setMsg({ type: "error", text: err.message });
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!data || !lists) return <div className="panel portal-empty" style={{ marginTop: 28 }}>{loadMsg}</div>;

  const fields = data.fields;
  const field = fields.find((f) => f.id === selected);
  const mauze = lists.lists.find((l) => l.key === "mauzeType");
  const sections = [...new Set(fields.map((f) => f.section).filter(Boolean))];

  const moveField = (i, dir) => {
    const ids = fields.map((f) => f.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    act(() => fieldsOrder(ids), "Order saved.");
  };

  return (
    <>
      <section className="page-head">
        <div className="page-title">
          <h1>Portal Fields</h1>
          <p className="page-sub">The dropdown questions JCs answer on the JC portal. Each question has its own answers. Changes apply immediately.</p>
        </div>
      </section>

      {msg && <Notice type={msg.type} text={msg.text} onClose={() => setMsg(null)} />}

      <section className="masters-layout">
        {/* ---- list of questions ---- */}
        <aside className="panel">
          <div className="panel-head">
            <div><h2>Questions</h2><p>{plural(fields.length, "question")} · shown on the JC portal in this order</p></div>
          </div>
          <div className="add-line">
            <button type="button" className="btn btn-primary full" onClick={() => { setSelected("new"); setMsg(null); }} disabled={selected === "new"}>
              + Add question
            </button>
          </div>
          <div className="side-body master-list">
            {fields.map((f, i) => (
              <div key={f.id} className={`field-row${f.id === selected ? " is-sel" : ""}${f.isActive ? "" : " is-off"}`}>
                <button type="button" className="field-pick" onClick={() => { setSelected(f.id); setMsg(null); }}>
                  <span className="field-name">{f.label}</span>
                  <span className="field-meta">
                    {f.section && <span>{f.section}</span>}
                    {f.type === "date" && <span className="pill info">Date</span>}
                    {!f.isActive && <span className="pill na">Inactive</span>}
                    {!f.required && <span className="pill info">Optional</span>}
                    {!f.showOnDashboard && <span className="pill na">Not on dashboard</span>}
                  </span>
                </button>
                <span className="field-move">
                  <button type="button" className="mini-btn icon" disabled={busy || i === 0} onClick={() => moveField(i, -1)} aria-label={`Move ${f.label} up`}>
                    <span className="rot"><ChevronLeft size={14} /></span>
                  </button>
                  <button type="button" className="mini-btn icon" disabled={busy || i === fields.length - 1} onClick={() => moveField(i, 1)} aria-label={`Move ${f.label} down`}>
                    <span className="rot"><ChevronRight size={14} /></span>
                  </button>
                </span>
              </div>
            ))}
            <div className="eyebrow list-sep">Jamaat details</div>
            <div className={`field-row${selected === MAUZE ? " is-sel" : ""}`}>
              <button type="button" className="field-pick" onClick={() => { setSelected(MAUZE); setMsg(null); }}>
                <span className="field-name">Mauze Type</span>
                <span className="field-meta"><span>{plural(mauze.values.length, "value")}</span></span>
              </button>
            </div>
          </div>
        </aside>

        {/* ---- editor ---- */}
        <div className="panel">
          {selected === "new" && (
            <NewField meanings={data.meanings} sections={sections} busy={busy}
              onCancel={() => setSelected(fields[0] ? fields[0].id : "new")}
              onCreate={async (body) => {
                const res = await act(() => fieldCreate(body), `Added the question “${body.label.trim()}”.`);
                if (res && res.createdId) setSelected(res.createdId);
              }} />
          )}
          {field && (
            <FieldEditor key={field.id} field={field} meanings={data.meanings} sections={sections} busy={busy} act={act}
              onDeleted={() => setSelected(fields.find((f) => f.id !== field.id)?.id || "new")} />
          )}
          {selected === MAUZE && <MauzeEditor list={mauze} busy={busy} act={act} />}
        </div>
      </section>

      <p className="dd-note">
        <b>Meaning</b> sets the colour of an answer on the dashboard and the completion rate: <i>Done</i> counts as done,
        <i> Not applicable</i> is left out, everything else counts as not done yet. Answers or questions already used in saved
        forms can't be deleted: rename an answer, or mark a question inactive (it disappears from the portal, history is kept).
      </p>
    </>
  );
}

// ---------- settings + answers of one question ----------
function FieldEditor({ field, meanings, sections, busy, act, onDeleted }) {
  const isDate = field.type === "date";
  const [form, setForm] = useState({ label: field.label, section: field.section, hasComment: field.hasComment, required: field.required, showOnDashboard: field.showOnDashboard });
  const dirty = form.label !== field.label || form.section !== field.section || form.hasComment !== field.hasComment || form.required !== field.required || form.showOnDashboard !== field.showOnDashboard;
  const toneOf = (m) => (meanings.find((x) => x.key === m) || {}).tone || "na";

  const save = (e) => {
    e.preventDefault();
    act(() => fieldUpdate(field.id, form), "Question saved.");
  };
  const toggleActive = () => {
    if (field.isActive && !window.confirm(`Mark “${field.label}” inactive?\n\nIt will disappear from the JC portal and the dashboard. Saved answers are kept.`)) return;
    act(() => fieldUpdate(field.id, { isActive: !field.isActive }), `“${field.label}” is now ${field.isActive ? "inactive" : "active"}.`);
  };
  const remove = async () => {
    if (!window.confirm(`Delete the question “${field.label}”? This cannot be undone.`)) return;
    if (await act(() => fieldDelete(field.id), `Deleted “${field.label}”.`)) onDeleted();
  };

  return (
    <>
      <div className="panel-head master-head">
        <div>
          <h2>{field.label} {!field.isActive && <span className="pill na">Inactive</span>}</h2>
          <p>{isDate ? "Date question · " : "Dropdown · "}{field.answered ? `Answered in ${plural(field.answered, "saved form")}` : "Not answered yet"}</p>
        </div>
        <div className="head-actions">
          <button type="button" className="mini-btn" onClick={toggleActive} disabled={busy}>{field.isActive ? "Mark inactive" : "Mark active"}</button>
          <button type="button" className="mini-btn danger" onClick={remove} disabled={busy || field.answered > 0}
            title={field.answered ? "Answered in saved forms: mark it inactive instead" : "Delete"}>Delete</button>
        </div>
      </div>

      <form className="field-form" onSubmit={save}>
        <label className="field">
          <span className="field-label">Question</span>
          <input className="input" value={form.label} maxLength={80} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Section heading <span className="optional">(optional)</span></span>
          <input className="input" list="sections" value={form.section} maxLength={60} placeholder="e.g. Event Status"
            onChange={(e) => setForm({ ...form, section: e.target.value })} />
          <datalist id="sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Required on the JC portal</label>
          <label className="check"><input type="checkbox" checked={form.hasComment} onChange={(e) => setForm({ ...form, hasComment: e.target.checked })} /> Include comment box</label>
          {!isDate && <label className="check"><input type="checkbox" checked={form.showOnDashboard} onChange={(e) => setForm({ ...form, showOnDashboard: e.target.checked })} /> Show a card on the dashboard</label>}
        </div>
        <div className="field-form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>Save question</button>
        </div>
      </form>

      <div className="eyebrow sub-head">Preview on the JC portal</div>
      <div className="dd-preview">
        {isDate
          ? <input className="input date-input" type="date" disabled aria-label="Date picker preview" />
          : field.options.map((o) => <span key={o.id} className={`pill ${toneOf(o.meaning)}`}>{o.value}</span>)}
        {field.hasComment && <textarea className="input q-comment" rows={2} disabled placeholder="Comment (optional)" aria-label="Comment box preview" />}
      </div>

      {!isDate && (
        <>
          <div className="eyebrow sub-head">Answers</div>
          <OptionsTable
            values={field.options}
            meanings={meanings}
            busy={busy}
            usedLabel="Saved answers using it"
            onMove={(ids) => act(() => optionsOrder(field.id, ids), "Order saved.")}
            onSave={(o, body) => act(() => optionEdit(field.id, o.id, body), "Answer saved.")}
            onRemove={(o) => act(() => optionRemove(field.id, o.id), `Removed “${o.value}”.`)}
            onAdd={(body) => act(() => optionAdd(field.id, body), `Added “${body.value.trim()}”.`)}
          />
        </>
      )}
    </>
  );
}

// ---------- create a question ----------
function NewField({ meanings, sections, busy, onCancel, onCreate }) {
  const [f, setF] = useState(blankNew);
  const setOpt = (i, patch) => setF({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  const isDate = f.type === "date";
  const submit = (e) => {
    e.preventDefault();
    if (isDate) {
      const { options, showOnDashboard, ...rest } = f;
      return onCreate(rest);
    }
    const options = f.options.filter((o) => o.value.trim() || o.meaning);
    onCreate({ ...f, options });
  };

  return (
    <>
      <div className="panel-head"><div><h2>New question</h2><p>It appears on the JC portal as soon as you create it.</p></div></div>
      <form className="field-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Question</span>
          <input className="input" autoFocus value={f.label} maxLength={80} placeholder="e.g. Health camp held?"
            onChange={(e) => setF({ ...f, label: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Section heading <span className="optional">(optional)</span></span>
          <input className="input" list="sections-new" value={f.section} maxLength={60} placeholder="e.g. Event Status"
            onChange={(e) => setF({ ...f, section: e.target.value })} />
          <datalist id="sections-new">{sections.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="field">
          <span className="field-label">Type of answer</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="select">Dropdown (choose one answer)</option>
            <option value="date">Date picker</option>
          </select>
        </label>
        <div className="checks">
          <label className="check"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Required on the JC portal</label>
          <label className="check"><input type="checkbox" checked={f.hasComment} onChange={(e) => setF({ ...f, hasComment: e.target.checked })} /> Include comment box <span className="optional">(shown after the answers)</span></label>
          {!isDate && <label className="check"><input type="checkbox" checked={f.showOnDashboard} onChange={(e) => setF({ ...f, showOnDashboard: e.target.checked })} /> Show a card on the dashboard</label>}
        </div>

        {!isDate && <>
        <div className="answers-head">
          <span className="field-label">Answers</span>
          <span className="presets">
            Start from:
            {Object.entries(PRESETS).map(([name, opts]) => (
              <button key={name} type="button" className="mini-btn" onClick={() => setF({ ...f, options: opts.map(([value, meaning]) => ({ value, meaning })) })}>{name}</button>
            ))}
          </span>
        </div>
        {f.options.map((o, i) => (
          <div className="answer-line" key={i}>
            <input className="input" value={o.value} maxLength={40} placeholder={`Answer ${i + 1}`} onChange={(e) => setOpt(i, { value: e.target.value })} aria-label={`Answer ${i + 1}`} />
            <select value={o.meaning} onChange={(e) => setOpt(i, { meaning: e.target.value })} aria-label={`Meaning of answer ${i + 1}`}>
              <option value="">Meaning…</option>
              {meanings.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <button type="button" className="mini-btn" disabled={f.options.length <= 2} onClick={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })} aria-label="Remove answer"><CloseIcon /></button>
          </div>
        ))}
        <button type="button" className="mini-btn add-answer" onClick={() => setF({ ...f, options: [...f.options, { value: "", meaning: "" }] })}>+ Add answer</button>
        </>}

        <div className="field-form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Create question</button>
        </div>
      </form>
    </>
  );
}

// ---------- Mauze Type ----------
function MauzeEditor({ list, busy, act }) {
  return (
    <>
      <div className="panel-head"><div><h2>Mauze Type</h2><p>Used by: {list.usedBy.join(", ")}</p></div></div>
      <OptionsTable
        values={list.values}
        busy={busy}
        usedLabel="Jamaats using it"
        placeholder="New Mauze Type"
        onMove={(ids) => act(() => listOrder(list.key, ids), "Order saved.", "lists")}
        onSave={(v, body) => act(() => listEdit(list.key, v.id, { value: body.value }), "Saved.", "lists")}
        onRemove={(v) => act(() => listRemove(list.key, v.id), `Removed “${v.value}”.`, "lists")}
        onAdd={(body) => act(() => listAdd(list.key, { value: body.value }), `Added “${body.value.trim().toUpperCase()}”.`, "lists")}
      />
    </>
  );
}

// ---------- table of answers / values (meanings shown when `meanings` is given) ----------
function OptionsTable({ values, meanings, busy, usedLabel, placeholder = "New answer", onMove, onSave, onRemove, onAdd }) {
  const [edit, setEdit] = useState(null); // { id, value, meaning }
  const [draft, setDraft] = useState({ value: "", meaning: "" });
  const withMeaning = !!meanings;
  const meaningOf = (k) => (meanings || []).find((m) => m.key === k);

  const move = (i, dir) => {
    const ids = values.map((v) => v.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    onMove(ids);
  };
  const save = async (e) => {
    e.preventDefault();
    const old = values.find((v) => v.id === edit.id);
    if (old && old.inUse && old.value !== edit.value.trim() &&
      !window.confirm(`Rename “${old.value}” to “${edit.value.trim()}”?\n\nIt is used ${old.inUse} time${old.inUse === 1 ? "" : "s"}; those will be renamed too.`)) return;
    if (await onSave(old, withMeaning ? { value: edit.value, meaning: edit.meaning } : { value: edit.value })) setEdit(null);
  };
  const add = async (e) => {
    e.preventDefault();
    if (!draft.value.trim()) return;
    if (await onAdd(draft)) setDraft({ value: "", meaning: "" });
  };

  return (
    <>
      <form onSubmit={save} className="table-wrap">
        <table className="master-table dd-table card-rows">
          <thead>
            <tr>
              <th>Order</th><th>{withMeaning ? "Answer" : "Value"}</th>{withMeaning && <th>Meaning on the dashboard</th>}
              <th title={usedLabel}>In use</th><th />
            </tr>
          </thead>
          <tbody>
            {values.map((v, i) => {
              const editing = edit && edit.id === v.id;
              return (
                <tr key={v.id} className={editing ? "edit-row" : ""}>
                  <td className="order-cell" data-label="Order">
                    <button type="button" className="mini-btn icon" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${v.value} up`}>
                      <span className="rot"><ChevronLeft size={14} /></span>
                    </button>
                    <button type="button" className="mini-btn icon" disabled={busy || i === values.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${v.value} down`}>
                      <span className="rot"><ChevronRight size={14} /></span>
                    </button>
                  </td>
                  <td className="cell-main">
                    {editing ? (
                      <input className="input" autoFocus value={edit.value} maxLength={40} onChange={(e) => setEdit({ ...edit, value: e.target.value })} aria-label="Value" />
                    ) : <span className="jm-name">{v.value}</span>}
                  </td>
                  {withMeaning && (
                    <td className="wide" data-label="Meaning on the dashboard">
                      {editing ? (
                        <select value={edit.meaning} onChange={(e) => setEdit({ ...edit, meaning: e.target.value })} aria-label="Meaning">
                          {meanings.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                        </select>
                      ) : (
                        <span className="meaning"><span className={`dot tone-${meaningOf(v.meaning)?.tone || "na"}`} />{meaningOf(v.meaning)?.label || "—"}</span>
                      )}
                    </td>
                  )}
                  <td className="tnum" data-label="In use">{v.inUse}</td>
                  <td className="row-actions">
                    {editing ? (
                      <>
                        <button type="submit" className="mini-btn primary" disabled={busy}><CheckIcon /> Save</button>
                        <button type="button" className="mini-btn" onClick={() => setEdit(null)} title="Cancel"><CloseIcon /></button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="mini-btn" disabled={busy} onClick={() => setEdit({ id: v.id, value: v.value, meaning: v.meaning })}>Edit</button>
                        <button type="button" className="mini-btn danger" disabled={busy || v.inUse > 0} onClick={() => window.confirm(`Remove “${v.value}”?`) && onRemove(v)}
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

      <form className="add-line dd-add" onSubmit={add}>
        <input className="input" placeholder={placeholder} value={draft.value} maxLength={40}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })} aria-label={placeholder} />
        {withMeaning && (
          <select value={draft.meaning} onChange={(e) => setDraft({ ...draft, meaning: e.target.value })} aria-label="Meaning of the new answer">
            <option value="">Meaning…</option>
            {meanings.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
      </form>
    </>
  );
}
