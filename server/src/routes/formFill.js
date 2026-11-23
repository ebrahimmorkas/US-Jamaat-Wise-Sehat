// Filling a form: /api/f/:code — open to everyone; who may fill depends on the form:
//   signed_in      a signed-in Jamaat Coordinator
//   personal_link  the encrypted personal link (?t=) — the Gmail inside it is the person; no sign-in
//   anyone         anyone with the link; they type their email, which must be a Jamaat Coordinator's
// While a form is in "Testing", only signed-in testers can open it (the form's own rules still apply).
// Every response has a Jamiat and Jamaat: the Coordinator's own (locked) when we know who they are
// (signed in / personal link), otherwise chosen from dropdowns ("anyone" forms, testers).
// The public page never sees a database id: forms use their random code, other ids are sealed (F.seal).
// A signed-in JC may fill for one of their Jamaats, on behalf of its Coordinator (?for=<sealed Jamaat>):
// the response is the Jamaat's (it counts for the Coordinator) and is marked "filled by JC".
//   GET    /:code?t=&for=     the form + who is filling + their earlier responses (when editing is allowed)
//   POST   /:code/upload      raw file body (?field=&t=) -> { id, token } to send with the answers
//   POST   /:code/submit      { answers, email?, jamiat?, jamaat?, t?, for?, responseId?, editKey? }
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { isDbReady } = require("../db");
const { checkAccess } = require("../middleware/auth");
const Form = require("../models/Form");
const FormResponse = require("../models/FormResponse");
const FormUpload = require("../models/FormUpload");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { audit } = require("../services/audit");
const { activeMasters } = require("../services/data");
const { InputError, sendError } = require("../lib/validate");
const { isDeleted, notDeleted } = require("../lib/softDelete");
const { clientIp } = require("../lib/clientIp");
const storage = require("../services/storage");
const config = require("../config");
const F = require("../services/forms");
const reminders = require("../services/reminders");

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

async function loadForm(code) {
  if (!F.isCode(code)) throw new Stop("NOT_FOUND", "This form doesn't exist. Check the link.");
  const f = await Form.findOne({ code }).lean();
  if (!f || isDeleted(f) || f.stage === "draft") throw new Stop("NOT_FOUND", "This form doesn't exist or isn't available yet. Check the link.");
  return f;
}

/** A Jamaat (active, in an active Jamiat) -> { jamaat, jamiat, jamaatName, jamiatName }, or null. */
async function place(jamaatId) {
  if (!jamaatId) return null;
  const jm = await Jamaat.findOne({ _id: jamaatId, isActive: true, ...notDeleted() }).select("name jamiat").lean();
  const jt = jm && (await Jamiat.findOne({ _id: jm.jamiat, isActive: true, ...notDeleted() }).select("name").lean());
  return jm && jt ? { jamaat: jm._id, jamiat: jt._id, jamaatName: jm.name, jamiatName: jt.name } : null;
}
/** Jamiat + Jamaat chosen in the dropdowns (by name; the page never sees ids). */
async function placeByName(jamiatName, jamaatName) {
  const a = String(jamiatName || "").trim();
  const b = String(jamaatName || "").trim();
  if (!a || !b || a.length > 120 || b.length > 120) return null;
  const jt = await Jamiat.findOne({ name: a, isActive: true, ...notDeleted() }).select("name").lean();
  const jm = jt && (await Jamaat.findOne({ jamiat: jt._id, name: b, isActive: true, ...notDeleted() }).select("name").lean());
  return jm ? { jamaat: jm._id, jamiat: jt._id, jamaatName: jm.name, jamiatName: jt.name } : null;
}

/**
 * Who is filling, and may they? Resolves to
 * { email, emailKey, name, user, place, coordinator, verified, via, isTest, emailLocked, needEmail, needJamaat }.
 * place = their own Jamaat (locked on the form) when we know who they are and they are a Coordinator.
 */
async function filler(req, form, { typedEmail } = {}) {
  const session = await checkAccess(req).catch(() => ({}));
  const me = session.user || null;
  const state = F.stateOf(form);
  const isTest = form.stage === "testing";
  if (state === "closed" || state === "ended") throw new Stop("CLOSED", "This form is closed. It isn't accepting responses any more.", { endAt: form.endAt });
  if (state === "not_started") throw new Stop("NOT_STARTED", "This form isn't open yet.", { startAt: form.startAt });
  if (isTest) {
    if (!me) throw new Stop("NEED_LOGIN", "This form is being tested. Sign in with a tester account to fill it.");
    const tester = await User.findById(me.id).select("isTester").lean();
    if (!tester || !tester.isTester) throw new Stop("NOT_TESTER", "This form is being tested. Only testers can fill it for now.");
  }
  const forJamaat = req.query.for || (req.body && req.body.for);
  if (forJamaat) return onBehalf(me, forJamaat, isTest);
  const base = { via: form.access, isTest, user: null, place: null, coordinator: false, name: "", verified: false, emailLocked: false, needEmail: false };
  let email = "";
  if (form.access === "signed_in") {
    if (!me) throw new Stop("NEED_LOGIN", "Sign in with your Google account to fill this form.");
    if (me.role !== "jamaat_coordinator" && !isTest) throw new Stop("NOT_ALLOWED", "This form is for Jamaat Coordinators. You are signed in with an account that isn't one.");
    email = me.email;
    Object.assign(base, { verified: true, emailLocked: true });
  } else if (form.access === "personal_link") {
    email = F.readToken(form.code, req.query.t || (req.body && req.body.t));
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
    const u = await User.findOne({ emailKey: key, ...notDeleted() }).select("name role jamaat isActive").lean()
      || await User.findOne({ email, ...notDeleted() }).select("name role jamaat isActive").lean();
    if (u) {
      base.user = u._id;
      base.name = u.name || "";
      base.coordinator = u.role === "jamaat_coordinator" && u.isActive !== false;
      // Their own Jamaat is filled in and locked only when we know it is them (signed in / personal link).
      if (base.coordinator && base.verified) base.place = await place(u.jamaat);
    }
  }
  base.needJamaat = !base.place;
  return { ...base, email, emailKey: email ? F.emailKeyOf(email) : "" };
}

/** A JC filling for one of their Jamaats (sealed id), on behalf of its Jamaat Coordinator. */
async function onBehalf(me, sealedJamaat, isTest) {
  if (!me) throw new Stop("NEED_LOGIN", "Sign in with your Google account to fill this form for a Jamaat.");
  if (me.role !== "jc") throw new Stop("NOT_ALLOWED", "Only a JC can fill a form on behalf of a Jamaat.");
  const jcUser = await User.findOne({ _id: me.id, isActive: true, ...notDeleted() }).select("name email jamiats jamaats").lean();
  const id = F.unseal(sealedJamaat);
  const where = id ? await place(id) : null;
  const mine = (list, x) => (list || []).some((y) => String(y) === String(x));
  if (!jcUser || !where || !mine(jcUser.jamaats, where.jamaat) || !mine(jcUser.jamiats, where.jamiat)) {
    throw new Stop("NOT_ALLOWED", "This Jamaat isn't one of yours, so you can't fill the form for it.");
  }
  const coord = await User.findOne({ role: "jamaat_coordinator", jamaat: where.jamaat, ...notDeleted() }).select("name email").lean();
  const email = coord ? coord.email : "";
  return {
    via: "jc_on_behalf", isTest, user: coord ? coord._id : null, place: where, coordinator: true, name: coord ? coord.name || "" : "",
    verified: true, emailLocked: true, needEmail: false, needJamaat: false, email,
    // The Jamaat's responses: its Coordinator's Gmail (the same limit), or the Jamaat itself when it has no Coordinator yet.
    emailKey: coord ? F.emailKeyOf(email) : `jamaat:${where.jamaat}`,
    onBehalf: { user: jcUser._id, email: jcUser.email, name: jcUser.name || "", role: "jc", coordinatorName: coord ? coord.name || "" : "", coordinatorEmail: email },
  };
}

const publicField = (f) => ({
  key: f.key, type: f.type, label: f.label, help: f.help, placeholder: f.placeholder, required: f.required,
  options: f.options ? f.options.map((o) => o.label) : undefined, min: f.min, max: f.max, maxFiles: f.maxFiles,
});
function publicForm(f) {
  return {
    id: f.code, title: f.title, description: f.description || "",
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
  if (who.verified && who.emailKey) return FormResponse.find({ ...q, emailKey: who.emailKey }).sort({ createdAt: -1 }).lean();
  if (editKey) return FormResponse.find({ ...q, editKeyHash: F.hash(editKey) }).lean();
  return [];
}
const usedCount = (form, who) => (who.emailKey ? FormResponse.countDocuments({ form: form._id, isTest: who.isTest, emailKey: who.emailKey }) : Promise.resolve(0));

// Jamiats and their Jamaats, by name, for the dropdowns.
async function placesList() {
  return (await activeMasters()).map((j) => ({ jamiat: j.name, jamaats: j.jamaats.map((jm) => jm.name) }));
}
const nameOf = async (Model, id) => { if (!id) return ""; const d = await Model.findById(id).select("name").lean(); return d ? d.name : ""; };

router.get("/:code", async (req, res, next) => {
  try {
    const form = await loadForm(req.params.code);
    let who;
    try { who = await filler(req, form); } catch (e) {
      if (!(e instanceof Stop)) throw e;
      // Enough to show a proper page (title, dates) with the message.
      return res.status(e.code === "NOT_FOUND" ? 404 : 403).json({ error: e.message, code: e.code, ...e.extra, form: { title: form.title, startAt: form.startAt, endAt: form.endAt, topImage: form.topImage && form.topImage.url ? storage.signedUrl(form.topImage) : "" } });
    }
    const used = await usedCount(form, who);
    const mine = form.allowEdit ? await earlier(form, who, String(req.get("x-edit-key") || "")) : [];
    res.json({
      form: publicForm(form),
      me: {
        email: who.email, name: who.name, emailLocked: who.emailLocked, needEmail: who.needEmail, isTest: who.isTest,
        jamiat: who.place ? who.place.jamiatName : "", jamaat: who.place ? who.place.jamaatName : "", needJamaat: who.needJamaat,
        onBehalf: who.onBehalf ? { jc: who.onBehalf.name || who.onBehalf.email, coordinator: who.onBehalf.coordinatorName || who.onBehalf.coordinatorEmail || "" } : null,
      },
      places: who.needJamaat ? await placesList() : undefined,
      used,
      remaining: form.maxPerPerson == null ? null : Math.max(0, form.maxPerPerson - used),
      mine: await Promise.all(mine.map(async (r) => ({
        id: F.seal(r._id), submittedAt: r.createdAt, editedAt: r.editedAt || null, answers: filesForBrowser(r.answers),
        jamiat: await nameOf(Jamiat, r.jamiat), jamaat: await nameOf(Jamaat, r.jamaat),
        byJc: r.onBehalf ? (r.filledBy && (r.filledBy.name || r.filledBy.email)) || "JC" : "",
      }))),
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
    out[k] = Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && v[0].upload ? v.map((x) => ({ id: F.seal(x.upload), name: x.name, size: x.size, type: x.type })) : v;
  }
  return out;
}

const uploadCap = Math.round(Math.max(...Object.values(config.forms.maxMb)) * 1024 * 1024);
router.post("/:code/upload", uploadLimiter, express.raw({ type: "application/octet-stream", limit: uploadCap }), async (req, res, next) => {
  try {
    const form = await loadForm(req.params.code);
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
    res.status(201).json({ id: F.seal(up._id), token, name: fileName, size: req.body.length, type });
  } catch (err) {
    if (err instanceof Stop) return stop(res, err);
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "The file is too large." });
    if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
    sendError(err, res, next);
  }
});

router.post("/:code/submit", submitLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const form = await loadForm(req.params.code);
    const who = await filler(req, form, { typedEmail: body.email });

    // Editing an earlier response (only when the form allows it, and only your own).
    let existing = null;
    if (body.responseId) {
      if (!form.allowEdit) throw new InputError("Responses to this form can't be changed.", 409);
      const rid = F.unseal(body.responseId);
      existing = rid ? await FormResponse.findOne({ _id: rid, form: form._id }).select("+editKeyHash") : null;
      const mineByEmail = existing && who.verified && existing.emailKey === who.emailKey;
      const mineByKey = existing && body.editKey && existing.editKeyHash === F.hash(body.editKey);
      if (!existing || !(mineByEmail || mineByKey)) throw new InputError("This response wasn't found, or it isn't yours.", 404);
    } else if (who.needEmail) {
      if (!F.simpleEmail(who.email)) return res.status(400).json({ error: "Enter your email address.", problems: { _email: "Enter a valid email address." } });
      // "Anyone" forms take only the emails of Jamaat Coordinators (testers may use any while testing).
      if (!who.coordinator && !who.isTest) {
        return res.status(400).json({ error: "This email can't fill this form.", problems: { _email: "This email is not registered as a Jamaat Coordinator. Use the Gmail you were registered with." } });
      }
    }
    if (!existing && form.maxPerPerson != null) {
      const used = await usedCount(form, who);
      if (used >= form.maxPerPerson) {
        throw new InputError(form.maxPerPerson === 1 ? "You have already filled this form." : `You have already filled this form ${used} times (the limit is ${form.maxPerPerson}).`, 409);
      }
    }

    // Jamiat and Jamaat: their own (locked), or chosen in the dropdowns.
    let where = who.place;
    if (!where && existing && !body.jamiat && !body.jamaat && existing.jamaat) {
      where = (await place(existing.jamaat)) || { jamaat: existing.jamaat, jamiat: existing.jamiat, jamaatName: "", jamiatName: "" }; // editing: keep it
    }
    if (!where) {
      where = await placeByName(body.jamiat, body.jamaat);
      if (!where) return res.status(400).json({ error: "Choose your Jamiat and Jamaat.", problems: { _jamaat: "Choose your Jamiat and Jamaat." } });
    }

    // Files: new ones need the upload token from this browser; kept ones must belong to this response.
    const claimed = [];
    const files = async (field, list) => {
      const out = [];
      for (const item of list) {
        const upId = item && F.unseal(item.id);
        if (!upId) throw new Error("Upload the file again.");
        const up = await FormUpload.findOne({ _id: upId, form: form._id, field: field.key }).select("+tokenHash").lean();
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
      existing.jamiat = where.jamiat;
      existing.jamaat = where.jamaat;
      existing.edits = (existing.edits || 0) + 1;
      existing.editedAt = new Date();
      existing.editedBy = who.onBehalf ? { email: who.onBehalf.email, name: who.onBehalf.name, role: "jc" } : { email: who.email, name: who.name, role: who.coordinator ? "jamaat_coordinator" : "" };
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
        name: who.name, user: who.user, jamiat: where.jamiat, jamaat: where.jamaat, answers, ...(editKey ? { editKeyHash: F.hash(editKey) } : {}),
        ...(who.onBehalf ? { onBehalf: true, filledBy: { user: who.onBehalf.user, email: who.onBehalf.email, name: who.onBehalf.name, role: "jc" } } : {}),
      });
    }
    if (claimed.length) await FormUpload.updateMany({ _id: { $in: claimed } }, { $set: { response: r._id } });
    audit(req, existing ? "form_response_edited" : "form_submitted", {
      username: who.onBehalf ? who.onBehalf.email : who.email,
      target: { type: "form", id: String(form._id), label: form.title },
      details: { response: String(r._id), via: who.via, test: who.isTest, verified: who.verified, jamaat: where.jamaatName, jamiat: where.jamiatName,
        ...(who.onBehalf ? { onBehalfOf: who.onBehalf.coordinatorEmail || "(no Coordinator yet)" } : {}) },
    });
    // "Send them a copy of their response" (goes out through the email history).
    reminders.sendResponseCopy(form, r.toObject ? r.toObject() : r, { edited: !!existing, jamaatName: where.jamaatName, byJc: who.onBehalf || null })
      .catch((e) => console.error("[forms] response copy", e && e.message));
    res.status(existing ? 200 : 201).json({ id: F.seal(r._id), ...(editKey ? { editKey } : {}), edited: !!existing });
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
