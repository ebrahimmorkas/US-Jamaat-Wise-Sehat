// Forms the Super Admin builds (instead of Google Forms) for Jamaat Coordinators.
//   Super Admin:  GET /meta, GET /, GET /:id, POST /, PUT /:id, POST /:id/status, POST|DELETE /:id/top-image,
//                 GET /:id/link?email=, GET /:id/links.xlsx, DELETE /:id/test-responses, DELETE /:id, POST /:id/restore
//   JC:           GET /jc-links   — the open forms with a link for each Jamaat Coordinator of their Jamaats
//   Coordinator:  GET /mine       — their forms ("My forms")
// Filling a form (no sign-in needed for some forms) is in routes/formFill.js.
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
const { InputError, requireId, sendError } = require("../lib/validate");
const { notDeleted, isDeleted, markDeleted, markRestored, deletedInfo } = require("../lib/softDelete");
const storage = require("../services/imagekit");
const config = require("../config");
const F = require("../services/forms");

const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});
const admin = requireRole("superadmin");

const STATUS_LABEL = { draft: "Draft", testing: "Testing", published: "Published", closed: "Closed" };
const target = (f) => ({ type: "form", id: String(f._id), label: f.title });
const topImageOut = (img) => (img && img.url ? { src: storage.signedUrl(img), width: img.width || 0, height: img.height || 0 } : null);

function formOut(f, counts = {}) {
  return {
    id: String(f._id),
    title: f.title,
    description: f.description || "",
    topImage: topImageOut(f.topImage),
    startAt: f.startAt, endAt: f.endAt,
    status: f.stage, state: F.stateOf(f),
    access: f.access,
    maxPerPerson: f.maxPerPerson,
    allowEdit: !!f.allowEdit, sendCopy: !!f.sendCopy,
    reminderHours: f.reminderHours || [],
    imageExt: f.imageExt || [], imageMaxMb: f.imageMaxMb,
    fields: (f.fields || []).map((x) => ({ ...(x.toObject ? x.toObject() : x), options: x.options || undefined })),
    link: F.formLink(f._id),
    responses: counts.responses || 0,
    testResponses: counts.tests || 0,
    answered: counts.answered || [],
    publishedAt: f.publishedAt || null,
    createdAt: f.createdAt, updatedAt: f.updatedAt, createdBy: f.createdBy || "", updatedBy: f.updatedBy || "",
    ...deletedInfo(f),
  };
}

async function countsFor(ids) {
  const rows = await FormResponse.aggregate([
    { $match: { form: { $in: ids } } },
    { $group: { _id: { form: "$form", test: "$isTest" }, n: { $sum: 1 } } },
  ]);
  const out = new Map();
  for (const r of rows) {
    const c = out.get(String(r._id.form)) || { responses: 0, tests: 0 };
    if (r._id.test) c.tests = r.n; else c.responses = r.n;
    out.set(String(r._id.form), c);
  }
  return out;
}
// Keys of the fields that have at least one answer (they can be hidden but not removed).
async function answeredKeys(formId) {
  const docs = await FormResponse.find({ form: formId }).select("answers").lean();
  const keys = new Set();
  for (const d of docs) for (const [k, v] of Object.entries(d.answers || {})) if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) keys.add(k);
  return keys;
}
async function findForm(id) {
  const f = await Form.findById(requireId(id, "form"));
  if (!f) throw new InputError("Form not found. Reload the page.", 404);
  return f;
}
const notDeletedForm = (f) => { if (isDeleted(f)) throw new InputError("This form is deleted. Restore it first.", 409); };

// ---------- Jamaat Coordinators (for links) ----------
/** Active Coordinators (optionally only of these Jamaats), with their Jamaat and Jamiat names. */
async function coordinators(jamaatIds) {
  const users = await User.find({ role: "jamaat_coordinator", isActive: true, ...notDeleted(), email: { $ne: null }, ...(jamaatIds ? { jamaat: { $in: jamaatIds } } : {}) })
    .select("email name jamaat").lean();
  const jms = await Jamaat.find({ _id: { $in: users.map((u) => u.jamaat).filter(Boolean) } }).select("name jamiat").lean();
  const jts = await Jamiat.find({ _id: { $in: jms.map((j) => j.jamiat) } }).select("name").lean();
  const jmOf = new Map(jms.map((j) => [String(j._id), j]));
  const jtName = new Map(jts.map((j) => [String(j._id), j.name]));
  return users.map((u) => {
    const jm = jmOf.get(String(u.jamaat));
    return { email: u.email, name: u.name || "", jamaat: jm ? jm.name : "", jamiat: jm ? jtName.get(String(jm.jamiat)) || "" : "" };
  }).sort((a, b) => a.jamiat.localeCompare(b.jamiat) || a.jamaat.localeCompare(b.jamaat));
}
const linkFor = (f, email) => (f.access === "personal_link" ? F.personalLink(f._id, email) : F.formLink(f._id));

// ---------- Super Admin ----------
router.get("/meta", admin, (req, res) => res.json(F.meta()));

router.get("/", admin, async (req, res, next) => {
  try {
    const forms = await Form.find().sort({ createdAt: -1 }).lean();
    const counts = await countsFor(forms.map((f) => f._id));
    res.json({ forms: forms.map((f) => formOut(f, counts.get(String(f._id)))), meta: F.meta() });
  } catch (err) { next(err); }
});

router.get("/jc-links", requireRole("jc"), async (req, res, next) => {
  try {
    const me = await User.findById(req.user.id).select("jamaats").lean();
    const forms = await Form.find({ stage: "published", ...notDeleted() }).sort({ endAt: 1 }).lean();
    const people = await coordinators((me && me.jamaats) || []);
    const live = forms.filter((f) => ["open", "not_started"].includes(F.stateOf(f)));
    res.json({
      forms: live.map((f) => ({
        id: String(f._id), title: f.title, startAt: f.startAt, endAt: f.endAt, state: F.stateOf(f), access: f.access,
        link: F.formLink(f._id),
        coordinators: people.map((p) => ({ ...p, link: linkFor(f, p.email) })),
      })),
    });
  } catch (err) { sendError(err, res, next); }
});

router.get("/mine", requireRole("jamaat_coordinator"), async (req, res, next) => {
  try {
    const me = await User.findById(req.user.id).select("email isTester jamaat").lean();
    const forms = await Form.find({ stage: { $in: me.isTester ? ["published", "testing", "closed"] : ["published", "closed"] }, ...notDeleted() }).sort({ startAt: -1 }).lean();
    const key = F.emailKeyOf(me.email);
    const used = await FormResponse.aggregate([{ $match: { form: { $in: forms.map((f) => f._id) }, emailKey: key } }, { $group: { _id: { form: "$form", test: "$isTest" }, n: { $sum: 1 }, last: { $max: "$createdAt" } } }]);
    const usedOf = (f) => used.find((u) => String(u._id.form) === String(f._id) && u._id.test === (f.stage === "testing")) || { n: 0 };
    res.json({
      forms: forms.map((f) => {
        const u = usedOf(f);
        return {
          id: String(f._id), title: f.title, description: (f.description || "").slice(0, 300), startAt: f.startAt, endAt: f.endAt,
          status: f.stage, state: F.stateOf(f), maxPerPerson: f.maxPerPerson, allowEdit: !!f.allowEdit,
          filled: u.n, lastFilled: u.last || null,
          link: linkFor(f, me.email), // their own link (personal forms: with their Gmail inside)
        };
      }),
    });
  } catch (err) { sendError(err, res, next); }
});

router.get("/:id", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    const counts = (await countsFor([f._id])).get(String(f._id)) || {};
    res.json({ form: formOut(f, { ...counts, answered: [...(await answeredKeys(f._id))] }), meta: F.meta() });
  } catch (err) { sendError(err, res, next); }
});

router.post("/", admin, async (req, res, next) => {
  try {
    const data = F.parseForm(req.body);
    const f = await Form.create({ ...data, stage: "draft", createdBy: req.user.email, updatedBy: req.user.email });
    audit(req, "form_created", { target: target(f), details: { fields: f.fields.length, access: f.access } });
    res.status(201).json({ form: formOut(f) });
  } catch (err) { sendError(err, res, next); }
});

router.put("/:id", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    notDeletedForm(f);
    const answered = await answeredKeys(f._id);
    const data = F.parseForm(req.body, f, answered);
    if (f.stage !== "draft") {
      const problems = F.readyProblems({ ...data });
      if (f.stage !== "closed" && problems.length) throw new InputError(`This form is ${STATUS_LABEL[f.stage]}: ${problems.join(" ")}`);
    }
    const before = { title: f.title, fields: f.fields.length, startAt: f.startAt, endAt: f.endAt, access: f.access };
    Object.assign(f, data, { updatedBy: req.user.email });
    await f.save();
    audit(req, "form_updated", {
      target: target(f),
      changes: [["title", "Title"], ["fields", "Fields"], ["startAt", "Start"], ["endAt", "End"], ["access", "Who can fill"]]
        .map(([k, label]) => ({ field: k, label, from: before[k] instanceof Date ? before[k].toISOString() : before[k], to: k === "fields" ? f.fields.length : f[k] instanceof Date ? f[k].toISOString() : f[k] }))
        .filter((c) => JSON.stringify(c.from) !== JSON.stringify(c.to)),
    });
    const counts = (await countsFor([f._id])).get(String(f._id)) || {};
    res.json({ form: formOut(f, { ...counts, answered: [...answered] }) });
  } catch (err) { sendError(err, res, next); }
});

// Draft -> Testing -> Published -> Closed (-> Published again). Testing / Published need dates and a question.
const MOVES = { draft: ["testing", "published"], testing: ["draft", "published"], published: ["closed", "testing"], closed: ["published"] };
router.post("/:id/status", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    notDeletedForm(f);
    const to = String((req.body || {}).status || "");
    if (!(MOVES[f.stage] || []).includes(to)) throw new InputError(`A ${STATUS_LABEL[f.stage] || f.stage} form can't be moved to ${STATUS_LABEL[to] || "that"}.`);
    if (["testing", "published"].includes(to)) {
      const problems = F.readyProblems(f);
      if (problems.length) throw new InputError(problems.join(" "));
    }
    if (to === "testing" && f.stage === "published" && await FormResponse.exists({ form: f._id, isTest: false })) {
      throw new InputError("People have already filled this form, so it can't go back to Testing. Close it instead.", 409);
    }
    const from = f.stage;
    f.stage = to;
    if (to === "published" && !f.publishedAt) f.publishedAt = new Date();
    f.updatedBy = req.user.email;
    await f.save();
    audit(req, "form_status_changed", { target: target(f), changes: [{ field: "status", label: "Status", from: STATUS_LABEL[from], to: STATUS_LABEL[to] }] });
    const counts = (await countsFor([f._id])).get(String(f._id)) || {};
    res.json({ form: formOut(f, counts) });
  } catch (err) { sendError(err, res, next); }
});

// Top image (shown at the top of the form). Raw image body, like the Stats images.
router.post("/:id/top-image", admin, express.raw({ type: "application/octet-stream", limit: Math.round(config.forms.maxMb.image * 1024 * 1024) }), async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    notDeletedForm(f);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new InputError("Choose an image.");
    let fileName = "";
    try { fileName = decodeURIComponent(String(req.get("x-file-name") || "")).slice(0, 150); } catch { /* keep empty */ }
    const rules = { ext: ["jpg", "jpeg", "png", "webp", "gif"], maxBytes: Math.round(config.forms.maxMb.image * 1024 * 1024), maxMb: config.forms.maxMb.image };
    const { ext, type } = F.checkUpload(req.body, fileName || "image.jpg", rules);
    const kept = await storage.uploadImage(req.body, { fileName: `form-top.${ext}`, type, folder: `${config.forms.folder}/top` });
    const old = f.topImage;
    f.topImage = { ...kept, name: fileName, size: req.body.length, type };
    f.updatedBy = req.user.email;
    await f.save();
    if (old && old.fileId) storage.deleteImage(old.fileId).catch(() => {});
    audit(req, "form_updated", { target: target(f), details: { topImage: "uploaded", size: req.body.length } });
    res.json({ topImage: topImageOut(f.topImage) });
  } catch (err) {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: `The image is too large. The limit is ${config.forms.maxMb.image} MB.` });
    if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
    sendError(err, res, next);
  }
});
router.delete("/:id/top-image", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    notDeletedForm(f);
    const old = f.topImage;
    f.topImage = undefined;
    await f.save();
    if (old && old.fileId) storage.deleteImage(old.fileId).catch(() => {});
    audit(req, "form_updated", { target: target(f), details: { topImage: "removed" } });
    res.json({ topImage: null });
  } catch (err) { sendError(err, res, next); }
});

// Personal link for any email (people from the Super Admin's own lists, not only users here).
router.get("/:id/link", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    const email = String(req.query.email || "").trim().toLowerCase();
    if (f.access !== "personal_link") return res.json({ link: F.formLink(f._id), personal: false });
    res.json({ link: F.personalLink(f._id, email), personal: true, email });
  } catch (err) { sendError(err, res, next); }
});

// Excel: every active Jamaat Coordinator with their link.
router.get("/:id/links.xlsx", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    const people = await coordinators(null);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Links");
    ws.columns = [
      { header: "Jamiat", key: "jamiat", width: 22 }, { header: "Jamaat", key: "jamaat", width: 26 },
      { header: "Coordinator", key: "name", width: 24 }, { header: "Gmail", key: "email", width: 32 }, { header: "Link", key: "link", width: 90 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const p of people) ws.addRow({ ...p, link: linkFor(f, p.email) });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    audit(req, "form_links_downloaded", { target: target(f), details: { people: people.length } });
    const safe = f.title.replace(/[^\w\- ]+/g, "").slice(0, 60).trim() || "Form";
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${safe} - links.xlsx"` });
    res.send(Buffer.from(buf));
  } catch (err) { sendError(err, res, next); }
});

// Removes everything filled while testing (and the uploaded files).
router.delete("/:id/test-responses", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    const tests = await FormResponse.find({ form: f._id, isTest: true }).select("_id").lean();
    const ids = tests.map((t) => t._id);
    const files = await FormUpload.find({ response: { $in: ids } }).select("fileId").lean();
    for (const x of files) await storage.deleteImage(x.fileId).catch(() => {});
    await FormUpload.deleteMany({ response: { $in: ids } });
    await FormResponse.deleteMany({ _id: { $in: ids } });
    audit(req, "form_test_cleared", { target: target(f), details: { responses: ids.length, files: files.length } });
    res.json({ removed: ids.length });
  } catch (err) { sendError(err, res, next); }
});

router.delete("/:id", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    if (isDeleted(f)) throw new InputError("This form is already deleted.", 409);
    markDeleted(f, req.user.email);
    await f.save();
    audit(req, "form_deleted", { target: target(f) });
    res.status(204).end();
  } catch (err) { sendError(err, res, next); }
});
router.post("/:id/restore", admin, async (req, res, next) => {
  try {
    const f = await findForm(req.params.id);
    if (!isDeleted(f)) throw new InputError("This form is not deleted.", 409);
    markRestored(f);
    await f.save();
    audit(req, "form_restored", { target: target(f) });
    res.json({ form: formOut(f) });
  } catch (err) { sendError(err, res, next); }
});

module.exports = router;
