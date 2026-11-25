// Responses of forms: /api/form-results — Super Admin, Saheb and JC.
//   Super Admin, Saheb: every Jamiat and Jamaat.  JC: only the Jamaats assigned to them (inside their Jamiats).
//   Test responses (filled while "Testing") are only for the Super Admin, and only when asked (?test=1).
//   GET /                      forms that have been published (Super Admin: also those in Testing)
//   GET /:code                 one form: questions + responses (?jamiat=&jamaat= names, ?test=1, ?from=&to= ISO times)
//                              + the form's reminders, in the order they are sent, with the time each was sent
//                              (the page turns "after / before / between reminders" into from / to)
//   GET /:code/excel           the same as an Excel file (?tz= the viewer's time zone)
//   GET /:code/status          every Jamaat in scope: filled or not, by whom, when (+ the reminders, as above)
//                              (?status=filled|not_filled&jamiat=&jamaat=&from=&to= ISO times)
//   GET /:code/status/excel    the same as an Excel file
//   GET/POST /:code/remind     "Send reminder": templates + who would get it / send it (Jamaats not filled)
// A JC also gets, for each of their Jamaats, a sealed `fillFor` to fill the form on behalf of it.
// Forms are addressed by their public code (never the database id).
const express = require("express");
const ExcelJS = require("exceljs");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const Form = require("../models/Form");
const FormResponse = require("../models/FormResponse");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { audit } = require("../services/audit");
const { InputError, sendError } = require("../lib/validate");
const { notDeleted } = require("../lib/softDelete");
const F = require("../services/forms");
const { layoutOf, topImageOf, responsesOut } = require("../services/formOut");
const EmailTemplate = require("../models/EmailTemplate");
const reminders = require("../services/reminders");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin", "saheb", "jc"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const isAdmin = (req) => req.user.role === "superadmin";
const stagesFor = (req) => (isAdmin(req) ? ["testing", "published", "closed"] : ["published", "closed"]);

/** Which responses this person may see: {} (all) or a filter on Jamiat + Jamaat (JC). */
async function scopeOf(req) {
  if (req.user.role !== "jc") return {};
  const u = await User.findById(req.user.id).select("jamiats jamaats").lean();
  return { jamiat: { $in: (u && u.jamiats) || [] }, jamaat: { $in: (u && u.jamaats) || [] } };
}

/** The Jamaats this person may see (JC: theirs, inside their Jamiats), with their Jamiat. */
async function jamaatsInScope(req) {
  const jts = await Jamiat.find({ isActive: true, ...notDeleted() }).select("name").lean();
  const q = { isActive: true, ...notDeleted(), jamiat: { $in: jts.map((j) => j._id) } };
  if (req.user.role === "jc") {
    const u = await User.findById(req.user.id).select("jamiats jamaats").lean();
    const allowedJt = new Set(((u && u.jamiats) || []).map(String));
    q._id = { $in: (u && u.jamaats) || [] };
    q.jamiat = { $in: jts.filter((j) => allowedJt.has(String(j._id))).map((j) => j._id) };
  }
  const jms = await Jamaat.find(q).select("name jamiat").lean();
  const jtName = new Map(jts.map((j) => [String(j._id), j.name]));
  return jms.map((j) => ({ _id: j._id, name: j.name, jamiatId: j.jamiat, jamiat: jtName.get(String(j.jamiat)) || "" }))
    .sort((a, b) => a.jamiat.localeCompare(b.jamiat) || a.name.localeCompare(b.name));
}

async function findForm(req, code) {
  if (!F.isCode(code)) throw new InputError("Form not found.", 404);
  const f = await Form.findOne({ code, stage: { $in: stagesFor(req) }, ...notDeleted() }).lean();
  if (!f) throw new InputError("Form not found. Reload the page.", 404);
  return f;
}

router.get("/", async (req, res, next) => {
  try {
    const forms = await Form.find({ stage: { $in: stagesFor(req) }, ...notDeleted() }).sort({ startAt: -1 }).lean();
    const scope = await scopeOf(req);
    const counts = await FormResponse.aggregate([
      { $match: { form: { $in: forms.map((f) => f._id) }, isTest: false, ...scope } },
      { $group: { _id: "$form", n: { $sum: 1 }, last: { $max: "$createdAt" } } },
    ]);
    const tests = isAdmin(req) ? await FormResponse.aggregate([{ $match: { form: { $in: forms.map((f) => f._id) }, isTest: true } }, { $group: { _id: "$form", n: { $sum: 1 } } }]) : [];
    const of = (list, f) => list.find((c) => String(c._id) === String(f._id));
    // How many of this person's Jamaats have filled each form.
    const jms = await jamaatsInScope(req);
    const filledJm = await FormResponse.aggregate([
      { $match: { form: { $in: forms.map((f) => f._id) }, isTest: false, jamaat: { $in: jms.map((j) => j._id) } } },
      { $group: { _id: { form: "$form", jamaat: "$jamaat" } } },
      { $group: { _id: "$_id.form", n: { $sum: 1 } } },
    ]);
    res.json({
      forms: forms.map((f) => ({
        id: f.code, title: f.title, status: f.stage, state: F.stateOf(f), startAt: f.startAt, endAt: f.endAt,
        responses: (of(counts, f) || {}).n || 0, lastAt: (of(counts, f) || {}).last || null, testResponses: (of(tests, f) || {}).n || 0,
        jamaats: jms.length, jamaatsFilled: (of(filledJm, f) || {}).n || 0,
      })),
    });
  } catch (err) { sendError(err, res, next); }
});

/** A time from the query (ISO), or null. */
const timeOf = (v) => { const d = v ? new Date(String(v).slice(0, 40)) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
/** { createdAt: { $gte, $lte } } for ?from= / ?to= (when the response was first sent), or {}. */
function sentBetween(q) {
  const from = timeOf(q.from);
  const to = timeOf(q.to);
  return from || to ? { createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {};
}

/**
 * The form's automatic reminders (set when the form was made), numbered in the order they are sent:
 * sent ones by the time they went out, then the ones still waiting by when they are due.
 * `at` = when it was sent (null = not sent: waiting, skipped or failed) — only sent ones can be used as a filter.
 * Keys are the rule keys (random, not database ids).
 */
async function reminderList(form) {
  const rules = form.reminders || [];
  if (!rules.length) return [];
  const tpls = await EmailTemplate.find({ _id: { $in: rules.map((r) => r.template) } }).select("name").lean();
  const tName = new Map(tpls.map((t) => [String(t._id), t.name]));
  const list = rules.map((r, i) => {
    const st = (r.state && r.state.status) || "waiting";
    const at = st === "sent" && r.state.at ? new Date(r.state.at) : null;
    const due = at ? null : reminders.dueAt(form, r);
    return { i, key: r.key, kind: r.when, when: reminders.RULE_TEXT(r), template: tName.get(String(r.template)) || "Deleted template", status: st, at, due: due || null };
  });
  const t = (r) => (r.at || (r.status === "waiting" || r.status === "sending" ? r.due : null) || new Date(8.64e15)).getTime();
  list.sort((a, b) => t(a) - t(b) || a.i - b.i);
  return list.map(({ i, ...r }, n) => ({ n: n + 1, ...r }));
}

/** Questions shown as columns: every non-layout question, plus hidden ones (they keep their answers). */
const columnsOf = (form) => form.fields.filter((x) => !F.TYPES[x.type].layout).map((x) => ({ key: x.key, label: x.label, type: x.type, hidden: !!x.hidden, max: x.max }));
/** The responses this person may see, with names and file links. */
async function loadRows(req, form, q) {
  const match = { form: form._id, ...(await scopeOf(req)) };
  match.isTest = isAdmin(req) && q.test === "1";
  // Filters by name (Jamiat, then Jamaat).
  if (q.jamiat) {
    const jt = await Jamiat.findOne({ name: String(q.jamiat).slice(0, 120) }).select("_id").lean();
    match.jamiat = match.jamiat ? { $in: match.jamiat.$in.filter((id) => jt && String(id) === String(jt._id)) } : (jt ? jt._id : { $in: [] });
    if (q.jamaat && jt) {
      const jm = await Jamaat.findOne({ jamiat: jt._id, name: String(q.jamaat).slice(0, 120) }).select("_id").lean();
      match.jamaat = match.jamaat ? { $in: match.jamaat.$in.filter((id) => jm && String(id) === String(jm._id)) } : (jm ? jm._id : { $in: [] });
    }
  }
  Object.assign(match, sentBetween(q));
  const list = await FormResponse.find(match).sort({ createdAt: -1 }).limit(20000).lean();
  return responsesOut(list, { hours: q.excel ? 24 * 7 : undefined }); // links in an Excel file work for 7 days
}

router.get("/:code", async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const rows = await loadRows(req, form, req.query);
    // Jamiat -> Jamaats for the filters: only places that have responses this person can see.
    const [all, rems] = await Promise.all([loadRows(req, form, { test: req.query.test }), reminderList(form)]);
    const places = {};
    for (const r of all) if (r.jamiat) (places[r.jamiat] = places[r.jamiat] || new Set()).add(r.jamaat);
    res.json({
      form: { id: form.code, title: form.title, description: form.description || "", status: form.stage, state: F.stateOf(form), startAt: form.startAt, endAt: form.endAt, columns: columnsOf(form),
        fields: layoutOf(form), topImage: topImageOf(form) },
      rows,
      total: all.length,
      places: Object.keys(places).sort().map((j) => ({ jamiat: j, jamaats: [...places[j]].sort() })),
      canSeeTests: isAdmin(req),
      reminders: rems,
    });
  } catch (err) { sendError(err, res, next); }
});

/** Every Jamaat in scope for one form: filled or not (in the date range, if given), by whom, when. */
async function statusRows(req, form, q) {
  let jms = await jamaatsInScope(req);
  const all = jms;
  if (q.jamiat) jms = jms.filter((j) => j.jamiat === String(q.jamiat));
  if (q.jamiat && q.jamaat) jms = jms.filter((j) => j.name === String(q.jamaat));
  const when = sentBetween(q);
  const [list, coords] = await Promise.all([
    FormResponse.find({ form: form._id, isTest: false, jamaat: { $in: jms.map((j) => j._id) }, ...when })
      .select("jamaat createdAt editedAt email name onBehalf filledBy").sort({ createdAt: -1 }).lean(),
    User.find({ role: "jamaat_coordinator", jamaat: { $in: jms.map((j) => j._id) }, ...notDeleted() }).select("name email jamaat isActive").lean(),
  ]);
  const byJm = new Map();
  for (const r of list) { const k = String(r.jamaat); if (!byJm.has(k)) byJm.set(k, []); byJm.get(k).push(r); }
  const coordOf = new Map(coords.map((c) => [String(c.jamaat), c]));
  const jc = req.user.role === "jc";
  const open = F.stateOf(form) === "open";
  let rows = jms.map((j) => {
    const rs = byJm.get(String(j._id)) || [];
    const c = coordOf.get(String(j._id));
    const last = rs[0];
    return {
      jamiat: j.jamiat, jamaat: j.name,
      coordinator: c ? { name: c.name || "", email: c.email || "", active: c.isActive !== false } : null,
      filled: rs.length > 0, count: rs.length, byJcCount: rs.filter((r) => r.onBehalf).length,
      last: last ? {
        at: last.createdAt, editedAt: last.editedAt || null,
        by: last.onBehalf ? "jc" : "coordinator",
        name: last.onBehalf ? (last.filledBy && (last.filledBy.name || last.filledBy.email)) || "JC" : last.name || last.email || "",
      } : null,
      fillFor: jc && open ? F.seal(j._id) : "", // a JC may fill for this Jamaat (on behalf of its Coordinator)
    };
  });
  const summary = { jamaats: rows.length, filled: rows.filter((r) => r.filled).length, byJc: rows.filter((r) => r.last && r.last.by === "jc").length };
  summary.notFilled = summary.jamaats - summary.filled;
  if (q.status === "filled") rows = rows.filter((r) => r.filled);
  else if (q.status === "not_filled") rows = rows.filter((r) => !r.filled);
  const places = {};
  for (const j of all) (places[j.jamiat] = places[j.jamiat] || []).push(j.name);
  return { rows, summary, places: Object.keys(places).sort().map((k) => ({ jamiat: k, jamaats: places[k] })), canFill: jc && open, allowEdit: !!form.allowEdit, maxPerPerson: form.maxPerPerson };
}

router.get("/:code/status", async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const [out, rems] = await Promise.all([statusRows(req, form, req.query), reminderList(form)]);
    res.json({ form: { id: form.code, title: form.title, state: F.stateOf(form), startAt: form.startAt, endAt: form.endAt }, ...out, reminders: rems });
  } catch (err) { sendError(err, res, next); }
});

// ---------- "Send reminder" (Super Admin, Saheb; a JC for their own Jamaats) ----------
// Goes to the Jamaat Coordinators of the Jamaats that haven't filled (within the page's Jamiat / Jamaat filter);
// Super Admin / Saheb may add the JCs of those Jamaats. Template ids are sealed (no database ids on the website).
async function remindScope(req, q) {
  let jms = await jamaatsInScope(req);
  if (q.jamiat) jms = jms.filter((j) => j.jamiat === String(q.jamiat));
  if (q.jamiat && q.jamaat) jms = jms.filter((j) => j.name === String(q.jamaat));
  return jms.map((j) => j._id);
}
function canRemind(form) {
  if (form.stage !== "published") return "Reminders can be sent only while the form is Published.";
  if (form.endAt && new Date(form.endAt) <= new Date()) return "The form has closed, so there is nothing to remind about.";
  return "";
}
const audienceOf = (req, v) => (req.user.role !== "jc" && v === "with_jc" ? "with_jc" : "coordinators");

router.get("/:code/remind", async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const [tpls, a] = await Promise.all([
      EmailTemplate.find({ ...notDeleted() }).select("name subject").sort({ name: 1 }).lean(),
      reminders.audience(form, { withJc: audienceOf(req, req.query.audience) === "with_jc", scope: await remindScope(req, req.query) }),
    ]);
    res.json({
      templates: tpls.map((t) => ({ id: F.seal(t._id), name: t.name, subject: t.subject })),
      blocked: canRemind(form),
      canAddJc: req.user.role !== "jc",
      preview: { notFilled: a.notFilled, coordinators: a.coordinators, jcs: a.jcs, withoutCoordinator: a.withoutCoordinator, total: a.recipients.length },
    });
  } catch (err) { sendError(err, res, next); }
});

router.post("/:code/remind", async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const blocked = canRemind(form);
    if (blocked) throw new InputError(blocked, 409);
    const b = req.body || {};
    const id = F.unseal(String(b.template || ""));
    if (!id) throw new InputError("Choose the email template.");
    const me = await User.findById(req.user.id).select("name email role").lean();
    const audience = audienceOf(req, b.audience);
    const out = await reminders.createReminder({
      form, templateId: id, withJc: audience === "with_jc", scope: await remindScope(req, b),
      by: { user: req.user.id, name: (me && me.name) || "", email: req.user.email, role: req.user.role }, what: "Reminder (sent by hand)",
    });
    if (!out.message) {
      throw new InputError(out.notFilled ? "Nobody to send to: the Jamaats that haven't filled it have no active Jamaat Coordinator." : "Every Jamaat here has filled the form — nobody to remind.", 409);
    }
    audit(req, "reminder_sent", { target: { type: "form", id: String(form._id), label: form.title }, details: { template: out.message.templateName, recipients: out.total, notFilled: out.notFilled, audience, jamiat: b.jamiat || "", jamaat: b.jamaat || "" } });
    res.status(201).json({ total: out.total, notFilled: out.notFilled });
  } catch (err) { sendError(err, res, next); }
});

/** An answer as text for Excel. */
function cellText(v, col) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? x.name : x)).join(", ");
  if (col.type === "rating") return `${v} / ${col.max || 5}`;
  return v;
}
function fmtTime(d, tz) {
  if (!d) return "";
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(d)); }
  catch { return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC"; }
}

const tzOf = (v) => { const tz = String(v || "UTC").slice(0, 60); try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return "UTC"; } };
const fileName = (form, what) => `${form.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "form"} - ${what}.xlsx`;
async function sendBook(res, wb, name) {
  res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.set("Content-Disposition", `attachment; filename="${name}"`);
  await wb.xlsx.write(res);
  res.end();
}

router.get("/:code/status/excel", async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const { rows } = await statusRows(req, form, req.query);
    const tz = tzOf(req.query.tz);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Jamaat status");
    ws.columns = [
      { header: "#", key: "n", width: 6 }, { header: "Jamiat", key: "jamiat", width: 22 }, { header: "Jamaat", key: "jamaat", width: 28 },
      { header: "Status", key: "status", width: 12 }, { header: "Responses", key: "count", width: 11 },
      { header: `Last filled (${tz})`, key: "at", width: 22 }, { header: "Filled by", key: "by", width: 34 },
      { header: "Jamaat Coordinator", key: "coord", width: 24 }, { header: "Coordinator Gmail", key: "coordEmail", width: 32 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    rows.forEach((r, i) => {
      const row = ws.addRow({
        n: i + 1, jamiat: r.jamiat, jamaat: r.jamaat, status: r.filled ? "Filled" : "Not filled", count: r.count,
        at: r.last ? fmtTime(r.last.at, tz) : "", by: r.last ? (r.last.by === "jc" ? `JC: ${r.last.name} (on behalf of the Coordinator)` : `Jamaat Coordinator: ${r.last.name}`) : "",
        coord: r.coordinator ? r.coordinator.name || "" : "No Coordinator", coordEmail: r.coordinator ? r.coordinator.email : "",
      });
      row.getCell("status").font = { bold: true, color: { argb: r.filled ? "FF15803D" : "FFB42323" } };
    });
    audit(req, "form_responses_exported", { target: { type: "form", id: String(form._id), label: form.title }, details: { what: "Jamaat status", rows: rows.length, status: req.query.status || "", jamiat: req.query.jamiat || "", jamaat: req.query.jamaat || "", from: req.query.from || "", to: req.query.to || "", filter: String(req.query.when || "").slice(0, 200) } });
    await sendBook(res, wb, fileName(form, "Jamaat status"));
  } catch (err) { sendError(err, res, next); }
});

router.get("/:code/excel", async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const rows = await loadRows(req, form, { ...req.query, excel: true });
    const cols = columnsOf(form);
    let tz = String(req.query.tz || "UTC").slice(0, 60);
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { tz = "UTC"; }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Responses");
    ws.columns = [
      { header: "#", key: "n", width: 6 },
      { header: `Submitted (${tz})`, key: "at", width: 22 },
      { header: "Jamiat", key: "jamiat", width: 22 },
      { header: "Jamaat", key: "jamaat", width: 26 },
      { header: "Email", key: "email", width: 32 },
      { header: "Name", key: "name", width: 22 },
      { header: "Filled by", key: "by", width: 34 },
      { header: "Changed", key: "edited", width: 22 },
      ...cols.map((c) => ({ header: c.hidden ? `${c.label} (removed question)` : c.label, key: c.key, width: Math.min(50, Math.max(14, c.label.length + 2)) })),
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    rows.forEach((r, i) => {
      const row = ws.addRow({
        n: i + 1, at: fmtTime(r.submittedAt, tz), jamiat: r.jamiat, jamaat: r.jamaat, email: r.email, name: r.name,
        by: r.byJc ? `JC: ${r.byJc.name || r.byJc.email} (on behalf of the Coordinator)` : "Jamaat Coordinator",
        edited: r.editedAt ? fmtTime(r.editedAt, tz) : "",
        ...Object.fromEntries(cols.map((c) => [c.key, cellText(r.answers[c.key], c)])),
      });
      // One file: a clickable link (works for 7 days). Several: names, links on separate lines.
      for (const c of cols) {
        const v = r.answers[c.key];
        if (!Array.isArray(v) || !v.length || typeof v[0] !== "object") continue;
        const cell = row.getCell(c.key);
        if (v.length === 1 && v[0].url) cell.value = { text: v[0].name || "file", hyperlink: v[0].url };
        else cell.value = v.map((x) => `${x.name}: ${x.url}`).join("\n");
        cell.font = { color: { argb: "FF1D4ED8" }, underline: v.length === 1 };
      }
    });
    audit(req, "form_responses_exported", { target: { type: "form", id: String(form._id), label: form.title }, details: { rows: rows.length, jamiat: req.query.jamiat || "", jamaat: req.query.jamaat || "", test: req.query.test === "1", from: req.query.from || "", to: req.query.to || "", filter: String(req.query.when || "").slice(0, 200) } });
    const name = `${form.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "form"} - responses.xlsx`;
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { sendError(err, res, next); }
});

module.exports = router;
