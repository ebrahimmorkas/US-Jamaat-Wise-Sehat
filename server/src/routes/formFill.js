// Filling a form: /api/f/:id — open to everyone; who may fill depends on the form:
//   signed_in      a signed-in Jamaat Coordinator
//   personal_link  the signed link (?t=) — the Gmail inside it is the person; no sign-in
//   anyone         anyone with the link; they type their email (not verified)
// While a form is in "Testing", only signed-in testers can open it (the form's own rules still apply).
//   GET    /:id?t=           the form + who is filling + their earlier responses (when editing is allowed)
//   POST   /:id/upload       raw file body (?field=&t=) -> { id, token } to send with the answers
//   POST   /:id/submit       { answers, email?, t?, responseId?, editKey? }
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { isDbReady } = require("../db");
const { checkAccess } = require("../middleware/auth");
const Form = require("../models/Form");
const FormResponse = require("../models/FormResponse");
const FormUpload = require("../models/FormUpload");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const { audit } = require("../services/audit");
const { InputError, isId, sendError } = require("../lib/validate");
const { isDeleted, notDeleted } = require("../lib/softDelete");
const { clientIp } = require("../lib/clientIp");
const storage = require("../services/imagekit");
const config = require("../config");
const F = require("../services/forms");

const router = express.Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});
const perIp = (limit, minutes, error) => rateLimit({
  windowMs: minutes * 60 * 1000, limit, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: (req) => `form:${ipKeyGenerator(clientIp(req))}`, message: { error },
});
const uploadLimiter = perIp(60, 10, "Too many uploads in a short time. Please wait a few minutes.");
const submitLimiter = perIp(30, 10, "Too many responses in a short time. Please wait a few minutes.");

/** A refusal the form page shows as a message (not an error page). */
class Stop extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}
const stop = (res, e) => res.status(e.code === "NOT_FOUND" ? 404 : 403).json({ error: e.message, code: e.code, ...e.extra });

async function loadForm(id) {
  if (!isId(id)) throw new Stop("NOT_FOUND", "This form doesn't exist. Check the link.");
  const f = await Form.findById(id).lean();
  if (!f || isDeleted(f) || f.stage === "draft") throw new Stop("NOT_FOUND", "This form doesn't exist or isn't available yet. Check the link.");
  return f;
}

/**
 * Who is filling, and may they? Resolves to
 * { email, emailKey, name, user, jamaat, verified, via, isTest, emailLocked, needEmail }.
 */
async function filler(req, form, { typedEmail } = {}) {
  const session = await checkAccess(req).catch(() => ({}));
  const me = session.user || null;
  const state = F.stateOf(form);
  const isTest = form.stage === "testing";
  if (state === "closed" || state === "ended") throw new Stop("CLOSED", "This form is closed. It isn't accepting responses any more.", { endAt: form.endAt });
  if (state === "not_started") throw new Stop("NOT_STARTED", "This form isn't open yet.", { startAt: form.startAt });
  let tester = null;
  if (isTest) {
    if (!me) throw new Stop("NEED_LOGIN", "This form is being tested. Sign in with a tester account to fill it.");
    tester = await User.findById(me.id).select("isTester").lean();
    if (!tester || !tester.isTester) throw new Stop("NOT_TESTER", "This form is being tested. Only testers can fill it for now.");
  }
  const base = { via: form.access, isTest, user: null, jamaat: null, name: "", verified: false, emailLocked: false, needEmail: false };
  let email = "";
  if (form.access === "signed_in") {
    if (!me) throw new Stop("NEED_LOGIN", "Sign in with your Google account to fill this form.");
    if (me.role !== "jamaat_coordinator" && !isTest) throw new Stop("NOT_ALLOWED", "This form is for Jamaat Coordinators. You are signed in with an account that isn't one.");
    email = me.email;
    Object.assign(base, { verified: true, emailLocked: true });
  } else if (form.access === "personal_link") {
    email = F.readToken(form._id, req.query.t || (req.body && req.body.t));
    if (!email && isTest && me) email = me.email; // testers may test without a personal link
    if (!email) throw new Stop("BAD_LINK", "This link isn't valid. Use the personal link you were sent, exactly as it was sent.");
    Object.assign(base, { verified: true, emailLocked: true });
  } else {
    email = String(typedEmail || "").trim().toLowerCase();
    base.needEmail = true;
    if (me && !email) email = me.email; // filled in for them; they can change it
  }
  if (email) {
    const key = F.emailKeyOf(email);
    const u = await User.findOne({ emailKey: key, ...notDeleted() }).select("name role jamaat").lean()
      || await User.findOne({ email, ...notDeleted() }).select("name role jamaat").lean();
    if (u) Object.assign(base, { user: u._id, name: u.name || "", jamaat: u.role === "jamaat_coordinator" ? u.jamaat || null : null });
  }
  return { ...base, email, emailKey: email ? F.emailKeyOf(email) : "" };
}

const publicField = (f) => ({
  key: f.key, type: f.type, label: f.label, help: f.help, placeholder: f.placeholder, required: f.required,
  options: f.options ? f.options.map((o) => o.label) : undefined, min: f.min, max: f.max, maxFiles: f.maxFiles,
});
function publicForm(f) {
  return {
    id: String(f._id), title: f.title, description: f.description || "",
    topImage: f.topImage && f.topImage.url ? storage.signedUrl(f.topImage) : "",
    startAt: f.startAt, endAt: f.endAt, status: f.stage, access: f.access,
    maxPerPerson: f.maxPerPerson, allowEdit: !!f.allowEdit, sendCopy: !!f.sendCopy,
    fields: f.fields.filter((x) => !x.hidden).map((x) => {
      const out = publicField(x);
      if (F.TYPES[x.type].upload) { const r = F.uploadRules(f, x); out.accept = r.ext; out.maxMb = r.maxMb; }
      return out;
    }),
  };
}
// Earlier responses of this person (to edit). "anyone" forms: only the one whose edit key the browser has.
async function earlier(form, who, editKey) {
  const q = { form: form._id, isTest: who.isTest };
  let list = [];
  if (who.verified && who.emailKey) list = await FormResponse.find({ ...q, emailKey: who.emailKey }).sort({ createdAt: -1 }).lean();
  else if (editKey) list = await FormResponse.find({ ...q, editKeyHash: F.hash(editKey) }).lean();
  return list;
}
const usedCount = (form, who) => (who.emailKey ? FormResponse.countDocuments({ form: form._id, isTest: who.isTest, emailKey: who.emailKey }) : Promise.resolve(0));

router.get("/:id", async (req, res, next) => {
  try {
    const form = await loadForm(req.params.id);
    let who;
    try { who = await filler(req, form); } catch (e) {
      if (!(e instanceof Stop)) throw e;
      // Enough to show a proper page (title, dates) with the message.
      return res.status(e.code === "NOT_FOUND" ? 404 : 403).json({ error: e.message, code: e.code, ...e.extra, form: { title: form.title, startAt: form.startAt, endAt: form.endAt, topImage: form.topImage && form.topImage.url ? storage.signedUrl(form.topImage) : "" } });
    }
    const used = await usedCount(form, who);
    const mine = form.allowEdit ? await earlier(form, who, String(req.get("x-edit-key") || "")) : [];
    let jamaat = "";
    if (who.jamaat) { const jm = await Jamaat.findById(who.jamaat).select("name").lean(); jamaat = jm ? jm.name : ""; }
    res.json({
      form: publicForm(form),
      me: { email: who.email, name: who.name, jamaat, emailLocked: who.emailLocked, needEmail: who.needEmail, isTest: who.isTest },
      used,
      remaining: form.maxPerPerson == null ? null : Math.max(0, form.maxPerPerson - used),
      mine: mine.map((r) => ({ id: String(r._id), submittedAt: r.createdAt, editedAt: r.editedAt || null, answers: filesForBrowser(r.answers) })),
    });
  } catch (err) {
    if (err instanceof Stop) return stop(res, err);
    sendError(err, res, next);
  }
});

// Files in an answer, as the browser shows them (name and size; the file itself stays private).
function filesForBrowser(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) {
    out[k] = Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && v[0].upload ? v.map((x) => ({ id: String(x.upload), name: x.name, size: x.size, type: x.type })) : v;
  }
  return out;
}

const uploadCap = Math.round(Math.max(...Object.values(config.forms.maxMb)) * 1024 * 1024);
router.post("/:id/upload", uploadLimiter, express.raw({ type: "application/octet-stream", limit: uploadCap }), async (req, res, next) => {
  try {
    const form = await loadForm(req.params.id);
    await filler(req, form, { typedEmail: "" });
    const field = form.fields.find((x) => x.key === req.query.field && !x.hidden && F.TYPES[x.type].upload);
    if (!field) throw new InputError("This question doesn't take files. Reload the form.");
    let fileName = "";
    try { fileName = decodeURIComponent(String(req.get("x-file-name") || "")).replace(/[\\/]/g, "_").slice(0, 150); } catch { /* keep empty */ }
    const rules = F.uploadRules(form, field);
    const { ext, type } = F.checkUpload(req.body, fileName, rules);
    const kept = await storage.uploadImage(req.body, { fileName: `${field.key}.${ext}`, type, folder: `${config.forms.folder}/${form._id}` });
    const token = F.randomKey();
    const up = await FormUpload.create({ form: form._id, field: field.key, kind: rules.kind, ...kept, name: fileName, size: req.body.length, type, tokenHash: F.hash(token) });
    res.status(201).json({ id: String(up._id), token, name: fileName, size: req.body.length, type });
  } catch (err) {
    if (err instanceof Stop) return stop(res, err);
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "The file is too large." });
    if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
    sendError(err, res, next);
  }
});

router.post("/:id/submit", submitLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const form = await loadForm(req.params.id);
    const who = await filler(req, form, { typedEmail: body.email });

    // Editing an earlier response (only when the form allows it, and only your own).
    let existing = null;
    if (body.responseId) {
      if (!form.allowEdit) throw new InputError("Responses to this form can't be changed.", 409);
      if (!isId(body.responseId)) throw new InputError("This response wasn't found.", 404);
      existing = await FormResponse.findOne({ _id: body.responseId, form: form._id }).select("+editKeyHash");
      const mineByEmail = existing && who.verified && existing.emailKey === who.emailKey;
      const mineByKey = existing && body.editKey && existing.editKeyHash === F.hash(body.editKey);
      if (!existing || !(mineByEmail || mineByKey)) throw new InputError("This response wasn't found, or it isn't yours.", 404);
    } else if (who.needEmail && !F.simpleEmail(who.email)) {
      return res.status(400).json({ error: "Enter your email address.", problems: { _email: "Enter a valid email address." } });
    }
    if (!existing && form.maxPerPerson != null) {
      const used = await usedCount(form, who);
      if (used >= form.maxPerPerson) {
        throw new InputError(form.maxPerPerson === 1 ? "You have already filled this form." : `You have already filled this form ${used} times (the limit is ${form.maxPerPerson}).`, 409);
      }
    }

    // Files: new ones need the upload token from this browser; kept ones must belong to this response.
    const claimed = [];
    const files = async (field, list) => {
      const out = [];
      for (const item of list) {
        if (!item || !isId(String(item.id))) throw new Error("Upload the file again.");
        const up = await FormUpload.findOne({ _id: item.id, form: form._id, field: field.key }).select("+tokenHash").lean();
        const ok = up && ((existing && String(up.response) === String(existing._id)) || (!up.response && item.token && up.tokenHash === F.hash(item.token)));
        if (!ok) throw new Error("A file couldn't be found. Remove it and upload it again.");
        out.push({ upload: up._id, name: up.name, size: up.size, type: up.type });
        claimed.push(up._id);
      }
      return out;
    };
    const { answers, problems } = await F.checkAnswers(form, body.answers, files, existing ? existing.answers : {});
    if (Object.keys(problems).length) return res.status(400).json({ error: "Some answers need attention.", problems });

    let r;
    let editKey;
    if (existing) {
      const before = new Set(Object.values(existing.answers || {}).flat().filter((x) => x && x.upload).map((x) => String(x.upload)));
      existing.answers = answers;
      existing.edits = (existing.edits || 0) + 1;
      existing.editedAt = new Date();
      existing.markModified("answers");
      r = await existing.save();
      // Files removed while editing are deleted.
      const now = new Set(claimed.map(String));
      const gone = [...before].filter((id) => !now.has(id));
      if (gone.length) {
        const docs = await FormUpload.find({ _id: { $in: gone }, response: r._id }).select("fileId").lean();
        for (const d of docs) storage.deleteImage(d.fileId).catch(() => {});
        await FormUpload.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
      }
    } else {
      editKey = form.allowEdit && !who.verified ? F.randomKey() : undefined;
      r = await FormResponse.create({
        form: form._id, isTest: who.isTest, via: who.via, email: who.email, emailKey: who.emailKey, verified: who.verified,
        name: who.name, user: who.user, jamaat: who.jamaat, answers, ...(editKey ? { editKeyHash: F.hash(editKey) } : {}),
      });
    }
    if (claimed.length) await FormUpload.updateMany({ _id: { $in: claimed } }, { $set: { response: r._id } });
    audit(req, existing ? "form_response_edited" : "form_submitted", {
      username: who.email,
      target: { type: "form", id: String(form._id), label: form.title },
      details: { response: String(r._id), via: who.via, test: who.isTest, verified: who.verified },
    });
    res.status(existing ? 200 : 201).json({ id: String(r._id), ...(editKey ? { editKey } : {}), edited: !!existing });
  } catch (err) {
    if (err instanceof Stop) return stop(res, err);
    sendError(err, res, next);
  }
});

/** Files uploaded but never sent with a response are removed after a day. */
async function cleanupUploads() {
  if (!isDbReady()) return;
  const old = await FormUpload.find({ response: null, createdAt: { $lt: new Date(Date.now() - 24 * 3600 * 1000) } }).select("fileId").limit(200).lean();
  for (const u of old) {
    try { await storage.deleteImage(u.fileId); await FormUpload.deleteOne({ _id: u._id }); } catch { /* next time */ }
  }
}
function startUploadCleanup() {
  const t = setInterval(() => cleanupUploads().catch(() => {}), 60 * 60 * 1000);
  t.unref();
}

module.exports = router;
module.exports.startUploadCleanup = startUploadCleanup;
