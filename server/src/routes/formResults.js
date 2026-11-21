// Responses of forms: /api/form-results — Super Admin, Saheb and JC.
//   Super Admin, Saheb: every Jamiat and Jamaat.  JC: only the Jamaats assigned to them (inside their Jamiats).
//   Test responses (filled while "Testing") are only for the Super Admin, and only when asked (?test=1).
//   GET /                      forms that have been published (Super Admin: also those in Testing)
//   GET /:code                 one form: questions + responses (?jamiat=&jamaat= names, ?test=1)
//   GET /:code/excel           the same as an Excel file (?tz= the viewer's time zone)
// Forms are addressed by their public code (never the database id).
const express = require("express");
const ExcelJS = require("exceljs");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const Form = require("../models/Form");
const FormResponse = require("../models/FormResponse");
const FormUpload = require("../models/FormUpload");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { audit } = require("../services/audit");
const { InputError, sendError } = require("../lib/validate");
const { notDeleted } = require("../lib/softDelete");
const storage = require("../services/imagekit");
const F = require("../services/forms");

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
    res.json({
      forms: forms.map((f) => ({
        id: f.code, title: f.title, status: f.stage, state: F.stateOf(f), startAt: f.startAt, endAt: f.endAt,
        responses: (of(counts, f) || {}).n || 0, lastAt: (of(counts, f) || {}).last || null, testResponses: (of(tests, f) || {}).n || 0,
      })),
    });
  } catch (err) { sendError(err, res, next); }
});

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
  const list = await FormResponse.find(match).sort({ createdAt: -1 }).limit(20000).lean();
  const jms = await Jamaat.find({ _id: { $in: [...new Set(list.map((r) => String(r.jamaat)).filter((x) => x !== "null"))] } }).select("name").lean();
  const jts = await Jamiat.find({ _id: { $in: [...new Set(list.map((r) => String(r.jamiat)).filter((x) => x !== "null"))] } }).select("name").lean();
  const jmName = new Map(jms.map((x) => [String(x._id), x.name]));
  const jtName = new Map(jts.map((x) => [String(x._id), x.name]));
  const ups = await FormUpload.find({ response: { $in: list.map((r) => r._id) } }).select("url endpoint name size type").lean();
  const upOf = new Map(ups.map((u) => [String(u._id), u]));
  const hours = q.excel ? 24 * 7 : undefined; // links in an Excel file work for 7 days
  return list.map((r) => {
    const answers = {};
    for (const [k, v] of Object.entries(r.answers || {})) {
      if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && v[0].upload) {
        answers[k] = v.map((x) => { const u = upOf.get(String(x.upload)); return { name: x.name, size: x.size, type: x.type, url: u ? storage.signedUrl(u, hours) : "" }; });
      } else answers[k] = v;
    }
    return {
      submittedAt: r.createdAt, editedAt: r.editedAt || null, edits: r.edits || 0,
      email: r.email || "", name: r.name || "", verified: !!r.verified, via: r.via,
      jamiat: jtName.get(String(r.jamiat)) || "", jamaat: jmName.get(String(r.jamaat)) || "",
      answers,
    };
  });
}

router.get("/:code", async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const rows = await loadRows(req, form, req.query);
    // Jamiat -> Jamaats for the filters: only places that have responses this person can see.
    const all = await loadRows(req, form, { test: req.query.test });
    const places = {};
    for (const r of all) if (r.jamiat) (places[r.jamiat] = places[r.jamiat] || new Set()).add(r.jamaat);
    res.json({
      form: { id: form.code, title: form.title, description: form.description || "", status: form.stage, state: F.stateOf(form), startAt: form.startAt, endAt: form.endAt, columns: columnsOf(form) },
      rows,
      total: all.length,
      places: Object.keys(places).sort().map((j) => ({ jamiat: j, jamaats: [...places[j]].sort() })),
      canSeeTests: isAdmin(req),
    });
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
      { header: "Changed", key: "edited", width: 22 },
      ...cols.map((c) => ({ header: c.hidden ? `${c.label} (removed question)` : c.label, key: c.key, width: Math.min(50, Math.max(14, c.label.length + 2)) })),
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    rows.forEach((r, i) => {
      const row = ws.addRow({
        n: i + 1, at: fmtTime(r.submittedAt, tz), jamiat: r.jamiat, jamaat: r.jamaat, email: r.email, name: r.name,
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
    audit(req, "form_responses_exported", { target: { type: "form", id: String(form._id), label: form.title }, details: { rows: rows.length, jamiat: req.query.jamiat || "", jamaat: req.query.jamaat || "", test: req.query.test === "1" } });
    const name = `${form.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "form"} - responses.xlsx`;
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { sendError(err, res, next); }
});

module.exports = router;
