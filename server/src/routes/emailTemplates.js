// Email templates (Super Admin and Saheb) — mounted inside /api/emails (same sign-in checks).
//   GET    /                 the templates (deleted ones with ?deleted=1)
//   GET    /:id              one template (with its attachments)
//   POST   /                 { name, subject, html, cc, bcc, greeting, files: [new attachment ids] }
//   PUT    /:id              same + keepFiles: [indexes of its attachments to keep]
//   DELETE /:id              status "D" (kept, restorable)
//   POST   /:id/restore
const express = require("express");
const EmailTemplate = require("../models/EmailTemplate");
const EmailFile = require("../models/EmailFile");
const { audit } = require("../services/audit");
const { InputError, isId, sendError } = require("../lib/validate");
const { notDeleted, isDeleted, markDeleted, markRestored } = require("../lib/softDelete");
const { readMessage } = require("../services/emailCompose");
const storage = require("../services/imagekit");
const config = require("../config");

const router = express.Router();
const fileOut = (f) => ({ name: f.name, size: f.size, type: f.type });
const out = (t, full) => ({
  id: String(t._id), name: t.name, subject: t.subject, cc: t.cc || [], bcc: t.bcc || [], greeting: t.greeting !== false,
  files: (t.files || []).map((f) => (full ? { ...fileOut(f), url: storage.signedUrl(f) } : fileOut(f))),
  updatedAt: t.updatedAt, updatedBy: t.updatedBy || t.createdBy || "", deleted: isDeleted(t),
  ...(full ? { html: t.html } : {}),
});
const target = (t) => ({ type: "email_template", id: String(t._id), label: t.name });
const keep = (f) => ({ fileId: f.fileId, filePath: f.filePath, url: f.url, endpoint: f.endpoint, name: f.name, size: f.size, type: f.type });

async function read(req, current) {
  const b = req.body || {};
  const name = String(b.name || "").replace(/\s+/g, " ").trim();
  if (!name) throw new InputError("Give the template a name.");
  if (name.length > 120) throw new InputError("The name is too long (120 characters at most).");
  const dup = await EmailTemplate.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), ...notDeleted(), ...(current ? { _id: { $ne: current._id } } : {}) }).select("_id").lean();
  if (dup) throw new InputError("A template with this name already exists.");
  const msg = await readMessage(b, { needForm: false }); // the form is chosen when sending
  const ids = [...new Set((Array.isArray(b.files) ? b.files : []).map(String))].slice(0, 20);
  if (ids.some((x) => !isId(x))) throw new InputError("An attachment wasn't found. Attach it again.");
  const added = ids.length ? await EmailFile.find({ _id: { $in: ids }, by: req.user.id, used: false }).lean() : [];
  if (added.length !== ids.length) throw new InputError("An attachment wasn't found. Attach it again.");
  const kept = current ? (current.files || []).filter((f, i) => (Array.isArray(b.keepFiles) ? b.keepFiles.map(Number) : []).includes(i)) : [];
  const files = [...kept.map(keep), ...added.map(keep)];
  if (files.reduce((n, f) => n + (f.size || 0), 0) > config.email.maxAttachMb * 1048576) throw new InputError(`The attachments are too large together (${config.email.maxAttachMb} MB at most).`);
  return { fields: { name, subject: msg.subject, html: msg.html, cc: msg.cc, bcc: msg.bcc, greeting: msg.greeting, files }, added };
}

router.get("/", async (req, res, next) => {
  try {
    const list = await EmailTemplate.find(req.query.deleted === "1" ? {} : notDeleted()).select("-html").sort({ name: 1 }).lean();
    res.json({ templates: list.map((t) => out(t, false)) });
  } catch (err) { sendError(err, res, next); }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Template not found.", 404);
    const t = await EmailTemplate.findById(req.params.id).lean();
    if (!t) throw new InputError("Template not found.", 404);
    res.json({ template: out(t, true) });
  } catch (err) { sendError(err, res, next); }
});

router.post("/", async (req, res, next) => {
  try {
    const { fields, added } = await read(req, null);
    const t = await EmailTemplate.create({ ...fields, createdBy: req.user.email, updatedBy: req.user.email });
    await EmailFile.updateMany({ _id: { $in: added.map((f) => f._id) } }, { $set: { used: true } });
    audit(req, "email_template_saved", { target: target(t), details: { created: true } });
    res.status(201).json({ template: out(t.toObject(), true) });
  } catch (err) { sendError(err, res, next); }
});

router.put("/:id", async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Template not found.", 404);
    const t = await EmailTemplate.findOne({ _id: req.params.id, ...notDeleted() });
    if (!t) throw new InputError("Template not found.", 404);
    const { fields, added } = await read(req, t);
    const changes = ["name", "subject", "html", "cc", "bcc", "greeting"]
      .filter((k) => JSON.stringify(t[k]) !== JSON.stringify(fields[k]))
      .map((k) => ({ field: k, label: { name: "Name", subject: "Subject", html: "Body", cc: "CC", bcc: "BCC", greeting: "Greeting" }[k], from: k === "html" ? "(changed)" : t[k], to: k === "html" ? "(changed)" : fields[k] }));
    if (fields.files.length !== t.files.length || added.length) changes.push({ field: "files", label: "Attachments", from: t.files.map((f) => f.name).join(", "), to: fields.files.map((f) => f.name).join(", ") });
    Object.assign(t, fields, { updatedBy: req.user.email });
    await t.save();
    await EmailFile.updateMany({ _id: { $in: added.map((f) => f._id) } }, { $set: { used: true } });
    audit(req, "email_template_saved", { target: target(t), changes });
    res.json({ template: out(t.toObject(), true) });
  } catch (err) { sendError(err, res, next); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Template not found.", 404);
    const t = await EmailTemplate.findOne({ _id: req.params.id, ...notDeleted() });
    if (!t) throw new InputError("Template not found.", 404);
    markDeleted(t, req.user.email);
    await t.save();
    audit(req, "email_template_deleted", { target: target(t) });
    res.json({ ok: true });
  } catch (err) { sendError(err, res, next); }
});

router.post("/:id/restore", async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Template not found.", 404);
    const t = await EmailTemplate.findById(req.params.id);
    if (!t || !isDeleted(t)) throw new InputError("Template not found.", 404);
    if (await EmailTemplate.exists({ _id: { $ne: t._id }, name: new RegExp(`^${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), ...notDeleted() })) throw new InputError("Another template now has this name. Rename that one first.", 409);
    markRestored(t);
    await t.save();
    audit(req, "email_template_restored", { target: target(t) });
    res.json({ template: out(t.toObject(), true) });
  } catch (err) { sendError(err, res, next); }
});

module.exports = router;
