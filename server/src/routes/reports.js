// Reports: /api/reports
//   Formats (Super Admin): one-page PDFs with "Image" boxes and "Jamiat" / "Jamaat" words.
//     GET  /formats                 list (every role here: to choose one when generating)
//     POST /formats?name=           upload a PDF (body = the file)      PUT /formats/:id  name, photo size
//     PUT  /formats/:id/file        replace the PDF                     DELETE /formats/:id
//     GET  /formats/:id/file        the PDF                             GET /formats/:id/sample  a sample report
//   Photos (Media, Super Admin): choose which photos of each Jamaat go in the report.
//     GET  /forms                   forms with photo questions (every role here)
//     GET  /forms/:code/photos      each Jamaat's photos + the chosen ones
//     PUT  /forms/:code/count       photos per Jamaat          PUT /forms/:code/picks  { jamaat, photos | null }
//     GET  /photos/:id/file         download one photo
//   Generate (Super Admin, Saheb, JC = own Jamaats, Media):
//     POST /generate { form, format } -> { job }    GET /jobs/:id    GET /jobs/:id/:which (photos | not-filled)
// Ids on the website are sealed (never database ids). Reports are made one at a time and kept for 2 hours.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const Form = require("../models/Form");
const FormResponse = require("../models/FormResponse");
const FormUpload = require("../models/FormUpload");
const ReportFormat = require("../models/ReportFormat");
const ReportPick = require("../models/ReportPick");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { audit } = require("../services/audit");
const { InputError, sendError } = require("../lib/validate");
const { notDeleted } = require("../lib/softDelete");
const F = require("../services/forms");
const storage = require("../services/storage");
const R = require("../services/reportPdf");

const MAX_FORMAT_MB = 12;
const KEEP_HOURS = 2;
const router = express.Router();
router.use(requireAuth, requireRole("superadmin", "saheb", "jc", "media"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});
const admin = requireRole("superadmin");
const chooser = requireRole("superadmin", "media");

// The format PDF's problems are explained to the Super Admin (400), like other input errors.
const sendFail = (err, res, next) => (err instanceof R.FormatError ? res.status(400).json({ error: err.message }) : sendError(err, res, next));
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const who = (req) => req.user.email;
const fileNameOf = (req) => { try { return clean(decodeURIComponent(req.get("x-file-name") || ""), 200); } catch { return ""; } };
const fileSafe = (s) => clean(s, 80).replace(/[\\/:*?"<>|]+/g, "-") || "report";
const disposition = (kind, name) => `${kind}; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// ---------- formats ----------
const formatOut = (f, full) => ({
  id: F.seal(f._id), name: f.name, summary: f.summary || "",
  slots: f.layout.slots.length, photos: Math.max(...f.layout.slots.map((s) => s.images.length)),
  ...(full ? {
    fileName: f.fileName || "", size: f.size || 0, photoW: f.photoW, photoH: f.photoH, suggested: f.layout.photoSize,
    page: { w: Math.round(f.layout.page.w / R.MM), h: Math.round(f.layout.page.h / R.MM) },
    updatedAt: f.updatedAt, updatedBy: f.updatedBy || f.createdBy || "",
  } : {}),
});
async function findFormat(id, withFile) {
  const real = F.unseal(id);
  if (!real) throw new InputError("Format not found. Reload the page.", 404);
  const q = ReportFormat.findOne({ _id: real, ...notDeleted() });
  const f = await (withFile ? q.select("+file") : q).lean();
  if (!f) throw new InputError("Format not found. Reload the page.", 404);
  return f;
}
const pdfBody = express.raw({ type: "application/octet-stream", limit: MAX_FORMAT_MB * 1024 * 1024 });
function readPdf(req) {
  const b = req.body;
  if (!Buffer.isBuffer(b) || !b.length) throw new InputError("Choose the format PDF.");
  if (b.subarray(0, 1024).toString("latin1").indexOf("%PDF-") < 0) throw new InputError("That file isn't a PDF. Upload the format as a PDF.");
  return b;
}
const mmOf = (v, label) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 5 || n > 600) throw new InputError(`${label} must be between 5 and 600 mm.`);
  return Math.round(n * 10) / 10;
};

router.get("/formats", async (req, res, next) => {
  try {
    const list = await ReportFormat.find(notDeleted()).sort({ name: 1 }).lean();
    res.json({ formats: list.map((f) => formatOut(f, req.user.role === "superadmin")), maxMb: MAX_FORMAT_MB });
  } catch (err) { next(err); }
});

router.post("/formats", admin, pdfBody, async (req, res, next) => {
  try {
    const name = clean(req.query.name, 120);
    if (!name) throw new InputError("Give the format a name.");
    const bytes = readPdf(req);
    const layout = await R.analyze(bytes);
    const f = await ReportFormat.create({
      name, fileName: fileNameOf(req), size: bytes.length, file: bytes, layout, summary: R.describe(layout),
      photoW: layout.photoSize.w, photoH: layout.photoSize.h, createdBy: who(req),
    });
    audit(req, "report_format_saved", { target: { type: "report_format", id: String(f._id), label: name }, details: { added: true, summary: f.summary } });
    res.status(201).json({ format: formatOut(f.toObject(), true) });
  } catch (err) { sendFail(err, res, next); }
});

router.put("/formats/:id", admin, async (req, res, next) => {
  try {
    const f = await findFormat(req.params.id);
    const b = req.body || {};
    const set = { updatedBy: who(req) };
    if (b.name !== undefined) { set.name = clean(b.name, 120); if (!set.name) throw new InputError("Give the format a name."); }
    const w = mmOf(b.photoW, "Photo width"), h = mmOf(b.photoH, "Photo height");
    if (w !== undefined) set.photoW = w;
    if (h !== undefined) set.photoH = h;
    const u = await ReportFormat.findByIdAndUpdate(f._id, { $set: set }, { new: true }).lean();
    audit(req, "report_format_saved", { target: { type: "report_format", id: String(f._id), label: u.name }, details: { name: u.name, photoW: u.photoW, photoH: u.photoH } });
    res.json({ format: formatOut(u, true) });
  } catch (err) { sendFail(err, res, next); }
});

router.put("/formats/:id/file", admin, pdfBody, async (req, res, next) => {
  try {
    const f = await findFormat(req.params.id);
    const bytes = readPdf(req);
    const layout = await R.analyze(bytes);
    const u = await ReportFormat.findByIdAndUpdate(f._id, { $set: {
      file: bytes, size: bytes.length, fileName: fileNameOf(req), layout, summary: R.describe(layout),
      photoW: layout.photoSize.w, photoH: layout.photoSize.h, updatedBy: who(req),
    } }, { new: true }).lean();
    audit(req, "report_format_saved", { target: { type: "report_format", id: String(f._id), label: u.name }, details: { newFile: true, summary: u.summary } });
    res.json({ format: formatOut(u, true) });
  } catch (err) { sendFail(err, res, next); }
});

router.delete("/formats/:id", admin, async (req, res, next) => {
  try {
    const f = await findFormat(req.params.id);
    await ReportFormat.updateOne({ _id: f._id }, { $set: { status: "D", deletedAt: new Date(), deletedBy: who(req) } });
    audit(req, "report_format_deleted", { target: { type: "report_format", id: String(f._id), label: f.name } });
    res.json({ ok: true });
  } catch (err) { sendFail(err, res, next); }
});

router.get("/formats/:id/file", admin, async (req, res, next) => {
  try {
    const f = await findFormat(req.params.id, true);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", disposition("attachment", f.fileName || `${fileSafe(f.name)}.pdf`));
    res.send(Buffer.from(f.file.buffer || f.file));
  } catch (err) { sendFail(err, res, next); }
});

// A sample: every place filled with grey "Photo" boxes and "Jamaat 1", "Jamiat 1"... (+ a page with fewer photos).
router.get("/formats/:id/sample", admin, async (req, res, next) => {
  try {
    const f = await findFormat(req.params.id, true);
    const w = mmOf(req.query.w, "Photo width") || f.photoW, h = mmOf(req.query.h, "Photo height") || f.photoH;
    const out = await R.buildReport({ bytes: Buffer.from(f.file.buffer || f.file), layout: f.layout, photoSize: { w, h }, groups: R.sampleGroups(f.layout), loadPhoto: async () => null, title: `${f.name} - sample` });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", disposition("attachment", `${fileSafe(f.name)} - sample.pdf`));
    res.send(Buffer.from(out.bytes));
  } catch (err) { sendFail(err, res, next); }
});

// ---------- forms and their photos ----------
const stagesFor = (req) => (req.user.role === "superadmin" ? ["testing", "published", "closed"] : ["published", "closed"]);
const photoFields = (form) => form.fields.filter((x) => x.type === "image");

async function findForm(req, code) {
  if (!F.isCode(code)) throw new InputError("Form not found.", 404);
  const f = await Form.findOne({ code, stage: { $in: stagesFor(req) }, ...notDeleted() }).lean();
  if (!f || !photoFields(f).length) throw new InputError("Form not found. Reload the page.", 404);
  return f;
}

/** Active Jamaats this person may see (JC: theirs inside their Jamiats), with the Jamiat name, Jamiat then Jamaat A-Z. */
async function jamaatsInScope(req) {
  const jts = await Jamiat.find({ isActive: true, ...notDeleted() }).select("name").lean();
  const q = { isActive: true, ...notDeleted(), jamiat: { $in: jts.map((j) => j._id) } };
  if (req.user.role === "jc") {
    const u = await User.findById(req.user.id).select("jamiats jamaats").lean();
    const allowed = new Set(((u && u.jamiats) || []).map(String));
    q._id = { $in: (u && u.jamaats) || [] };
    q.jamiat = { $in: jts.filter((j) => allowed.has(String(j._id))).map((j) => j._id) };
  }
  const jms = await Jamaat.find(q).select("name jamiat").lean();
  const jtName = new Map(jts.map((j) => [String(j._id), j.name]));
  return jms.map((j) => ({ _id: j._id, name: j.name, jamiat: jtName.get(String(j.jamiat)) || "" }))
    .sort((a, b) => a.jamiat.localeCompare(b.jamiat) || a.name.localeCompare(b.name));
}

/**
 * Every Jamaat in scope with its photos in the order they were uploaded (responses oldest first, then the
 * form's photo questions in order) and the photos going in the report (Media's choice, or the first ones).
 */
async function photosOf(req, form) {
  const jms = await jamaatsInScope(req);
  const responses = await FormResponse.find({ form: form._id, isTest: false, jamaat: { $in: jms.map((j) => j._id) } })
    .sort({ createdAt: 1 }).select("jamaat answers createdAt").lean();
  const fields = photoFields(form);
  const ids = [];
  for (const r of responses) for (const fl of fields) for (const a of (r.answers || {})[fl.key] || []) if (a && a.upload) ids.push(a.upload);
  const [ups, picks] = await Promise.all([
    FormUpload.find({ _id: { $in: ids }, form: form._id, kind: "image", response: { $ne: null } }).select("url endpoint name type size response createdAt").lean(),
    ReportPick.find({ form: form._id, jamaat: { $in: jms.map((j) => j._id) } }).lean(),
  ]);
  const upOf = new Map(ups.map((u) => [String(u._id), u]));
  const pickOf = new Map(picks.map((p) => [String(p.jamaat), p]));
  const filled = new Set(responses.map((r) => String(r.jamaat)));
  const count = form.reportPhotos || 2;
  return jms.map((j) => {
    const photos = [];
    for (const r of responses) {
      if (String(r.jamaat) !== String(j._id)) continue;
      for (const fl of fields) {
        for (const a of (r.answers || {})[fl.key] || []) {
          const u = a && a.upload && upOf.get(String(a.upload));
          if (u && String(u.response) === String(r._id)) photos.push({ ...u, field: fl.label, at: r.createdAt });
        }
      }
    }
    const pick = pickOf.get(String(j._id));
    const have = new Set(photos.map((p) => String(p._id)));
    const chosen = pick ? pick.uploads.map(String).filter((id) => have.has(id)).slice(0, count) : photos.slice(0, count).map((p) => String(p._id));
    return { jamaat: j, filled: filled.has(String(j._id)), photos, chosen, picked: !!pick, pickedBy: pick && pick.by ? pick.by.name || ROLE_NAME[pick.by.role] || "Media" : "" }; // a name, never a Gmail
  });
}

const ROLE_NAME = { media: "Media", superadmin: "Super Admin" };
const thumb = (u) => storage.variantUrl(u, { w: 360, h: 360 });

router.get("/forms", async (req, res, next) => {
  try {
    const forms = await Form.find({ stage: { $in: stagesFor(req) }, "fields.type": "image", ...notDeleted() }).sort({ startAt: -1 }).lean();
    res.json({
      forms: forms.map((f) => ({ code: f.code, title: f.title, status: f.stage, state: F.stateOf(f), startAt: f.startAt, endAt: f.endAt, photosPerJamaat: f.reportPhotos || 2 })),
    });
  } catch (err) { next(err); }
});

router.get("/forms/:code/photos", chooser, async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const list = await photosOf(req, form);
    const filled = list.filter((x) => x.filled);
    res.json({
      form: { code: form.code, title: form.title, status: form.stage, photosPerJamaat: form.reportPhotos || 2 },
      notFilled: list.length - filled.length,
      jamaats: filled.map((x) => ({
        id: F.seal(x.jamaat._id), jamiat: x.jamaat.jamiat, name: x.jamaat.name, picked: x.picked, pickedBy: x.pickedBy,
        chosen: x.chosen.map((id) => x.photos.findIndex((p) => String(p._id) === id)),
        photos: x.photos.map((p) => ({ id: F.seal(p._id), name: p.name || "photo", field: p.field, at: p.at, thumb: thumb(p), url: storage.signedUrl(p) })),
      })),
    });
  } catch (err) { sendFail(err, res, next); }
});

router.put("/forms/:code/count", chooser, async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const n = Number((req.body || {}).count);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new InputError("Type how many photos each Jamaat gets (1 to 10).");
    await Form.updateOne({ _id: form._id }, { $set: { reportPhotos: n } });
    audit(req, "report_photos_chosen", { target: { type: "form", id: String(form._id), label: form.title }, details: { photosPerJamaat: n, before: form.reportPhotos || 2 } });
    res.json({ photosPerJamaat: n });
  } catch (err) { sendFail(err, res, next); }
});

// photos: sealed photo ids in order (at most "photos per Jamaat"); null = back to the first photos.
router.put("/forms/:code/picks", chooser, async (req, res, next) => {
  try {
    const form = await findForm(req, req.params.code);
    const b = req.body || {};
    const jamaatId = F.unseal(b.jamaat);
    if (!jamaatId) throw new InputError("Jamaat not found. Reload the page.", 404);
    const entry = (await photosOf(req, form)).find((x) => String(x.jamaat._id) === jamaatId);
    if (!entry || !entry.filled) throw new InputError("Jamaat not found. Reload the page.", 404);
    const count = form.reportPhotos || 2;
    let label;
    if (b.photos === null) {
      await ReportPick.deleteOne({ form: form._id, jamaat: jamaatId });
      label = "first photos";
    } else {
      if (!Array.isArray(b.photos)) throw new InputError("Choose the photos.");
      const ids = [...new Set(b.photos.map((x) => F.unseal(x)))];
      if (ids.some((x) => !x)) throw new InputError("A photo was not found. Reload the page.", 404);
      if (ids.length > count) throw new InputError(`Choose at most ${count} photo${count === 1 ? "" : "s"} (photos per Jamaat).`);
      const have = new Set(entry.photos.map((p) => String(p._id)));
      if (ids.some((x) => !have.has(x))) throw new InputError("A photo was not found. Reload the page.", 404);
      await ReportPick.updateOne({ form: form._id, jamaat: jamaatId },
        { $set: { uploads: ids, by: { email: req.user.email, name: req.user.name || "", role: req.user.role } } }, { upsert: true });
      label = `${ids.length} chosen`;
    }
    audit(req, "report_photos_chosen", { target: { type: "form", id: String(form._id), label: form.title }, details: { jamaat: entry.jamaat.name, jamiat: entry.jamaat.jamiat, photos: label } });
    res.json({ ok: true });
  } catch (err) { sendFail(err, res, next); }
});

router.get("/photos/:id/file", chooser, async (req, res, next) => {
  try {
    const id = F.unseal(req.params.id);
    if (!id) throw new InputError("Photo not found.", 404);
    const u = await FormUpload.findOne({ _id: id, kind: "image", response: { $ne: null } }).lean();
    const r = u && await FormResponse.findOne({ _id: u.response, isTest: false }).select("jamaat form").lean();
    const form = r && await Form.findOne({ _id: r.form, stage: { $in: stagesFor(req) }, ...notDeleted() }).select("title").lean();
    if (!form) throw new InputError("Photo not found.", 404);
    const got = await fetchPhoto(u, 0);
    const jm = await Jamaat.findById(r.jamaat).select("name").lean();
    const ext = (u.name || "").match(/\.[A-Za-z0-9]{1,5}$/);
    const name = `${fileSafe(jm ? jm.name : "Jamaat")} - ${fileSafe((u.name || "photo").replace(/\.[^.]+$/, ""))}${ext ? ext[0] : ".jpg"}`;
    audit(req, "report_photo_downloaded", { target: { type: "form", id: String(r.form), label: form.title }, details: { jamaat: jm ? jm.name : "", file: u.name || "" } });
    res.set("Content-Type", got.type || u.type || "application/octet-stream");
    res.set("Content-Disposition", disposition("attachment", name));
    res.send(got.bytes);
  } catch (err) { sendFail(err, res, next); }
});

/** A photo from wherever it was saved. px > 0: made smaller (as a JPEG) for the report. */
async function fetchPhoto(u, px) {
  return storage.readFile(u, px ? { w: px, h: px, jpg: true, quality: 82 } : null);
}

// ---------- generating ----------
const DIR = path.join(os.tmpdir(), "umoor-reports");
const jobs = new Map(); // id -> job (kept KEEP_HOURS)
let queue = Promise.resolve(); // one report at a time (memory)

function sweep() {
  const old = Date.now() - KEEP_HOURS * 3600 * 1000;
  for (const [id, j] of jobs) {
    if (j.createdAt < old) {
      for (const f of Object.values(j.files || {})) fs.promises.unlink(f.path).catch(() => {});
      jobs.delete(id);
    }
  }
}
setInterval(sweep, 10 * 60 * 1000).unref();

const jobOut = (j) => ({
  id: j.id, status: j.status, step: j.step, done: j.done, total: j.total, error: j.error || "",
  form: j.formTitle, format: j.formatName, createdAt: j.createdAt,
  files: Object.fromEntries(Object.entries(j.files || {}).map(([k, f]) => [k, { name: f.name, pages: f.pages, size: f.size }])),
  failed: j.failed || 0, jamaats: j.jamaats || 0, photos: j.photos || 0, notFilled: j.notFilled || 0, noPhoto: j.noPhoto || 0,
});

async function runJob(job, { req, form, format }) {
  job.status = "running";
  job.step = "Reading the responses";
  const list = await photosOf(req, form);
  const filled = list.filter((x) => x.filled);
  const slots = format.layout.slots;
  const maxPer = Math.max(...slots.map((s) => s.images.length));
  const upOf = new Map(filled.flatMap((x) => x.photos.map((p) => [String(p._id), p])));
  const groups = filled.map((x) => ({ jamiat: x.jamaat.jamiat, jamaat: x.jamaat.name, photos: x.chosen.slice(0, maxPer).map((id) => upOf.get(id)) }))
    .filter((g) => g.photos.length);
  const noPhoto = filled.filter((x) => !x.chosen.length);
  const notFilled = list.filter((x) => !x.filled);
  // Each Jamaat's place on the page decides how many of its photos fit (extra ones are left out).
  groups.forEach((g, i) => { g.photos = g.photos.slice(0, slots[i % slots.length].images.length); });
  job.total = groups.reduce((n, g) => n + g.photos.length, 0);
  job.done = 0;
  job.jamaats = groups.length;
  job.notFilled = notFilled.length;
  job.noPhoto = noPhoto.length;

  // photos are fetched a few at a time, ahead of where the report is
  const W = Math.max(format.photoW || 50, format.photoH || 50);
  const px = Math.min(1800, Math.max(300, Math.ceil((W / 25.4) * 200)));
  const order = groups.flatMap((g) => g.photos);
  const started = new Map();
  let next = 0;
  const start = () => { while (next < order.length && started.size - job.done < 6) { const u = order[next++]; if (!started.has(String(u._id))) started.set(String(u._id), fetchPhoto(u, px).catch(() => null)); } };
  const loadPhoto = async (u) => {
    start();
    if (!started.has(String(u._id))) started.set(String(u._id), fetchPhoto(u, px).catch(() => null));
    const got = await started.get(String(u._id));
    started.set(String(u._id), Promise.resolve(null)); // free the memory
    job.done++;
    job.step = `Adding photos (${job.done} of ${job.total})`;
    start();
    return got;
  };

  await fs.promises.mkdir(DIR, { recursive: true });
  const base = fileSafe(form.title);
  const made = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  job.files = {};
  if (groups.length) {
    job.step = "Adding photos";
    const out = await R.buildReport({ bytes: Buffer.from(format.file.buffer || format.file), layout: format.layout, photoSize: { w: format.photoW, h: format.photoH }, groups, loadPhoto, title: form.title });
    const p = path.join(DIR, `${job.id}-photos.pdf`);
    await fs.promises.writeFile(p, out.bytes);
    job.files.photos = { path: p, name: `${base} - report.pdf`, pages: out.pages, size: out.bytes.length };
    job.failed = out.failed;
    job.photos = job.total - out.failed;
  }
  job.step = "Making the list of Jamaats not filled";
  const nf = await R.notFilledPdf({
    title: form.title,
    note: `Jamaats that have not filled the form${req.user.role === "jc" ? " (your Jamaats)" : ""} · made ${made}`,
    sections: [
      { title: "Not filled", rows: notFilled.map((x) => ({ jamiat: x.jamaat.jamiat, jamaat: x.jamaat.name })), empty: "Every Jamaat has filled the form." },
      ...(noPhoto.length ? [{ title: "Filled, but no photo", rows: noPhoto.map((x) => ({ jamiat: x.jamaat.jamiat, jamaat: x.jamaat.name })) }] : []),
    ],
  });
  const p2 = path.join(DIR, `${job.id}-not-filled.pdf`);
  await fs.promises.writeFile(p2, nf);
  job.files.notFilled = { path: p2, name: `${base} - not filled.pdf`, pages: null, size: nf.length };
  job.status = "done";
  job.step = "Ready";
  audit(req, "report_generated", { target: { type: "form", id: String(form._id), label: form.title }, details: {
    format: format.name, jamaats: job.jamaats, photos: job.photos || 0, failedPhotos: job.failed || 0, notFilled: job.notFilled, noPhoto: job.noPhoto,
    pages: job.files.photos ? job.files.photos.pages : 0,
  } });
}

router.post("/generate", async (req, res, next) => {
  try {
    const b = req.body || {};
    const form = await findForm(req, b.form);
    const format = await findFormat(b.format, true);
    sweep();
    const running = [...jobs.values()].find((j) => j.owner === req.user.id && (j.status === "queued" || j.status === "running"));
    if (running) throw new InputError("Your last report is still being made. Wait for it to finish.", 409);
    const job = { id: crypto.randomBytes(12).toString("hex"), owner: req.user.id, status: "queued", step: "Waiting for another report to finish", done: 0, total: 0, createdAt: Date.now(), formTitle: form.title, formatName: format.name };
    jobs.set(job.id, job);
    const user = { ...req.user };
    const fakeReq = { user, ip: req.ip, headers: req.headers, get: req.get.bind(req), originalUrl: req.originalUrl, method: req.method, sessionId: req.sessionId, socket: req.socket };
    queue = queue.then(() => runJob(job, { req: fakeReq, form, format }).catch((err) => {
      job.status = "failed";
      job.error = err && err.expose ? err.message : "The report couldn't be made. Try again.";
      if (!(err && err.expose)) console.error("report failed:", err);
    }));
    res.status(202).json({ job: jobOut(job) });
  } catch (err) { sendFail(err, res, next); }
});

const myJob = (req) => {
  const j = jobs.get(String(req.params.id || ""));
  if (!j || j.owner !== req.user.id) throw new InputError("This report is no longer available. Generate it again.", 404);
  return j;
};
router.get("/jobs/:id", (req, res, next) => {
  try { res.json({ job: jobOut(myJob(req)) }); } catch (err) { sendFail(err, res, next); }
});
router.get("/jobs/:id/:which", async (req, res, next) => {
  try {
    const j = myJob(req);
    const f = j.files && j.files[req.params.which === "not-filled" ? "notFilled" : req.params.which === "photos" ? "photos" : ""];
    if (!f) throw new InputError("File not found.", 404);
    const data = await fs.promises.readFile(f.path).catch(() => null);
    if (!data) throw new InputError("This report is no longer available. Generate it again.", 404);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", disposition("attachment", f.name));
    res.send(data);
  } catch (err) { sendFail(err, res, next); }
});

module.exports = router;
