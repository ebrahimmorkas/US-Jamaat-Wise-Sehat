// "Send email" — Super Admin and Saheb: write an email (formatting, attachments), pick portal users
// (groups, Jamiat / Jamaat, people, typed Gmails of portal users), send now or later; see what was sent.
//   GET    /people              everyone who can be emailed + Jamiats/Jamaats (for the pickers)
//   POST   /preview             { to } -> the recipients it means (and typed emails that aren't portal users)
//   POST   /files               raw file body (X-File-Name) -> attachment { id, name, size, type }
//   DELETE /files/:id           remove an attachment not sent yet
//   POST   /                    { subject, html, to, files: [ids], sendAt? } -> the email (sent now, or at sendAt)
//   GET    /                    the sent / scheduled emails (newest first)
//   GET    /:id                 one email with every recipient's result
//   POST   /:id/cancel          a scheduled email (not sent yet)
//   POST   /:id/retry           send again to the recipients it failed for
// Super Admin only — the email provider:
//   GET    /settings/providers  providers (set up or not), the active one
//   PUT    /settings/providers  { provider: "nodemailer" | "sendgrid" }
//   POST   /settings/test       { provider } -> a test email to yourself through that provider
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const EmailMessage = require("../models/EmailMessage");
const EmailFile = require("../models/EmailFile");
const { audit } = require("../services/audit");
const { InputError, isId, sendError } = require("../lib/validate");
const { clientIp } = require("../lib/clientIp");
const storage = require("../services/imagekit");
const mail = require("../services/email");
const audience = require("../services/emailAudience");
const { kick, framed } = require("../services/outbox");
const { readMessage } = require("../services/emailCompose");
const vars = require("../services/emailVars");
const EmailTemplate = require("../models/EmailTemplate");
const Form = require("../models/Form");
const User = require("../models/User");
const config = require("../config");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin", "saheb"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});
const admin = requireRole("superadmin");
const sendLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: (req) => `email:${ipKeyGenerator(clientIp(req))}`, message: { error: "Too many emails in a short time. Please wait a few minutes." } });

const me = (req) => ({ user: req.user.id, email: req.user.email, name: req.user.name || "", role: req.user.role });
const target = (m) => ({ type: "email", id: String(m._id), label: m.subject });
const maxBytes = () => Math.round(config.email.maxAttachMb * 1024 * 1024);
// Files that may be attached (no programs or scripts).
const OK_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "txt", "jpg", "jpeg", "png", "gif", "webp", "heic", "zip", "mp4", "mov", "mp3", "m4a"]);

router.use("/templates", require("./emailTemplates"));

// The variables that can be used ({{…}}), grouped, for the editor's "Insert variable" menu.
router.get("/variables", async (req, res, next) => {
  try { res.json({ variables: await vars.list(), contact: config.contact }); } catch (err) { sendError(err, res, next); }
});

// Forms the {{Form …}} variables can be about.
router.get("/forms", async (req, res, next) => {
  try {
    const list = await Form.find({ status: { $ne: "D" }, code: { $exists: true } }).select("title code stage access startAt endAt").sort({ updatedAt: -1 }).limit(300).lean();
    res.json({ forms: list.map((f) => ({ code: f.code, title: f.title, stage: f.stage, access: f.access, startAt: f.startAt, endAt: f.endAt })) });
  } catch (err) { sendError(err, res, next); }
});

// An image (shown inside the email) or a document (linked from it). These are PUBLIC: anyone with the link
// can open them, because email apps can't sign in. Private files belong in the attachments instead.
const IMG_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "zip"]);
router.post("/public", express.raw({ type: "application/octet-stream", limit: maxBytes() }), async (req, res, next) => {
  try {
    let name = "";
    try { name = decodeURIComponent(String(req.get("x-file-name") || "")).replace(/[\\/]/g, "_").slice(0, 150); } catch { /* keep empty */ }
    const ext = (name.split(".").pop() || "").toLowerCase();
    const kind = IMG_EXT.has(ext) ? "image" : DOC_EXT.has(ext) ? "document" : "";
    if (!name || !kind) throw new InputError(`This kind of file can't be added. Images: ${[...IMG_EXT].join(", ").toUpperCase()}. Documents: ${[...DOC_EXT].join(", ").toUpperCase()}.`);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new InputError("The file is empty.");
    if (kind === "image" && req.body.length > config.email.maxImageMb * 1048576) throw new InputError(`The image is too large (${config.email.maxImageMb} MB at most). Make it smaller and try again.`);
    const type = String(req.get("x-file-type") || "").slice(0, 100) || "application/octet-stream";
    const kept = await storage.uploadImage(req.body, { fileName: name, type, folder: config.email.imageFolder, isPublic: true });
    audit(req, "email_file_published", { target: { type: "email_file", id: kept.fileId, label: name }, details: { kind, size: req.body.length } });
    res.status(201).json({ kind, name, url: kept.url, width: kept.width || 0, size: req.body.length });
  } catch (err) {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: `The file is too large (${config.email.maxAttachMb} MB at most).` });
    if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
    sendError(err, res, next);
  }
});

// The email exactly as one person would get it (variables filled) — "Preview".
//   { subject, html, greeting, form, user? }  (no user: the first person it would go to, or yourself)
router.post("/render", async (req, res, next) => {
  try {
    const b = req.body || {};
    const msg = await readMessage({ ...b, html: b.html || "<p>.</p>", subject: b.subject || "(no subject)" }, { needForm: false });
    let user = null;
    if (b.user && isId(String(b.user))) user = await User.findById(String(b.user)).select("name email role").lean();
    if (!user) user = await User.findById(req.user.id).select("name email role").lean();
    const ctx = await vars.prepare({ users: [user._id], form: msg.form, sender: me(req) });
    const person = { user: user._id, name: user.name, email: user.email, role: user.role };
    const body = framed({ ...msg, createdBy: me(req) }, person, vars.valuesFor(ctx, person));
    const missing = Object.entries(vars.valuesFor(ctx, person)).filter(([k, v]) => !v && new RegExp(`\\{\\{\\s*${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "i").test(`${msg.subject} ${msg.html.replace(/%7B%7B(.+?)%7D%7D/gi, (x, n) => `{{${decodeURIComponent(n)}}}`)}`)).map(([k]) => k);
    const formVar = (k) => vars.isFormVar(k);
    res.json({
      subject: body.subject, html: body.html, to: { name: user.name || "", email: user.email },
      missing: msg.form ? missing : missing.filter((k) => !formVar(k)),
      needsForm: msg.form ? [] : missing.filter(formVar), // filled once a form is chosen (when sending)
    });
  } catch (err) { sendError(err, res, next); }
});

router.get("/people", async (req, res, next) => {
  try {
    const { list, places } = await audience.people();
    res.json({
      people: list.map(({ emailKey, ...p }) => p),
      places,
      roles: Object.entries(audience.ROLES).map(([value, label]) => ({ value, label, count: list.filter((p) => p.role === value).length })),
      maxAttachMb: config.email.maxAttachMb,
      ready: mail.isReady(),
      timeZone: config.email.timeZone,
    });
  } catch (err) { sendError(err, res, next); }
});

router.post("/preview", async (req, res, next) => {
  try {
    const r = await audience.resolve((req.body || {}).to, { strict: false });
    res.json({ recipients: r.recipients, unknown: r.unknown, audience: r.audience });
  } catch (err) { sendError(err, res, next); }
});

router.post("/files", express.raw({ type: "application/octet-stream", limit: maxBytes() }), async (req, res, next) => {
  try {
    let name = "";
    try { name = decodeURIComponent(String(req.get("x-file-name") || "")).replace(/[\\/]/g, "_").slice(0, 150); } catch { /* keep empty */ }
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (!name || !OK_EXT.has(ext)) throw new InputError(`This kind of file can't be attached. Allowed: ${[...OK_EXT].map((x) => x.toUpperCase()).join(", ")}.`);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new InputError("The file is empty.");
    const type = String(req.get("x-file-type") || "").slice(0, 100) || "application/octet-stream";
    const kept = await storage.uploadImage(req.body, { fileName: name, type, folder: config.email.folder });
    const f = await EmailFile.create({ ...kept, name, size: req.body.length, type, by: req.user.id });
    res.status(201).json({ id: String(f._id), name, size: f.size, type });
  } catch (err) {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: `The file is too large (attachments up to ${config.email.maxAttachMb} MB in total).` });
    if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
    sendError(err, res, next);
  }
});

router.delete("/files/:id", async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Not found.", 404);
    const f = await EmailFile.findOne({ _id: req.params.id, by: req.user.id, used: false });
    if (f) { storage.deleteImage(f.fileId).catch(() => {}); await f.deleteOne(); }
    res.json({ ok: true });
  } catch (err) { sendError(err, res, next); }
});

router.post("/", sendLimiter, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { subject, html, text, cc, bcc, greeting, form } = await readMessage(b);
    const { recipients, audience: words } = await audience.resolve(b.to, { strict: true });
    if (!recipients.length) throw new InputError("Choose who gets this email.");

    const ids = [...new Set((Array.isArray(b.files) ? b.files : []).map(String))].slice(0, 20);
    if (ids.some((x) => !isId(x))) throw new InputError("An attachment wasn't found. Attach it again.");
    const uploaded = ids.length ? await EmailFile.find({ _id: { $in: ids }, by: req.user.id, used: false }).lean() : [];
    if (uploaded.length !== ids.length) throw new InputError("An attachment wasn't found. Attach it again.");
    // Started from a template: its attachments that were kept.
    let tpl = null;
    let fromTpl = [];
    if (b.template) {
      if (!isId(String(b.template))) throw new InputError("Template not found.");
      tpl = await EmailTemplate.findById(String(b.template)).select("name files").lean();
      if (!tpl) throw new InputError("Template not found.");
      const keepIdx = (Array.isArray(b.templateFiles) ? b.templateFiles : []).map(Number);
      fromTpl = (tpl.files || []).filter((f, i) => keepIdx.includes(i));
    }
    const files = [...fromTpl, ...uploaded];
    if (files.reduce((n, f) => n + (f.size || 0), 0) > maxBytes()) throw new InputError(`The attachments are too large together (${config.email.maxAttachMb} MB at most).`);

    let sendAt = new Date();
    if (b.sendAt) {
      const d = new Date(String(b.sendAt));
      if (Number.isNaN(d.getTime())) throw new InputError("The send time isn't valid.");
      if (d.getTime() > Date.now() + 366 * 24 * 3600 * 1000) throw new InputError("The send time is too far ahead (a year at most).");
      if (d.getTime() < Date.now() - 60000) throw new InputError("The send time has already passed. Pick a later time, or send now.");
      sendAt = d;
    }
    const later = sendAt.getTime() > Date.now() + 60000;
    const m = await EmailMessage.create({
      subject, html, text, audience: words, cc, bcc, greeting,
      ...(form ? { form: form._id } : {}), ...(tpl ? { template: tpl._id, templateName: tpl.name } : {}),
      copy: { status: cc.length || bcc.length ? "pending" : "none" },
      files: files.map((f) => ({ fileId: f.fileId, filePath: f.filePath, url: f.url, endpoint: f.endpoint, name: f.name, size: f.size, type: f.type })),
      recipients: recipients.map((r) => ({ ...r, status: "pending" })), total: recipients.length,
      status: "scheduled", sendAt, createdBy: me(req),
    });
    await EmailFile.updateMany({ _id: { $in: uploaded.map((f) => f._id) } }, { $set: { used: true } });
    audit(req, "email_sent", { target: target(m), details: { recipients: recipients.length, audience: words, files: files.length, ...(cc.length ? { cc: cc.join(", ") } : {}), ...(bcc.length ? { bcc: bcc.join(", ") } : {}), ...(tpl ? { template: tpl.name } : {}), ...(form ? { form: form.title } : {}), ...(later ? { scheduledFor: sendAt.toISOString() } : {}) } });
    if (!later) kick();
    res.status(201).json({ email: listOut(m.toObject()), ready: mail.isReady() });
  } catch (err) { sendError(err, res, next); }
});

const listOut = (m) => ({
  id: String(m._id), subject: m.subject, audience: m.audience, status: m.status, sendAt: m.sendAt, createdAt: m.createdAt,
  startedAt: m.startedAt || null, finishedAt: m.finishedAt || null, total: m.total, sent: m.sent, failed: m.failed,
  files: (m.files || []).length, by: m.createdBy ? { name: m.createdBy.name, email: m.createdBy.email, role: m.createdBy.role } : null,
  copy: m.copy && m.copy.status !== "none" ? m.copy.status : null, templateName: m.templateName || "",
  kind: m.kind || "email", automatic: !!(m.createdBy && !m.createdBy.email && !m.createdBy.role),
});

router.get("/", async (req, res, next) => {
  try {
    const kinds = ["email", "reminder", "response_copy"];
    const q = kinds.includes(req.query.kind) ? (req.query.kind === "email" ? { kind: { $in: ["email", null] } } : { kind: req.query.kind }) : {};
    const list = await EmailMessage.find(q).select("-recipients -html -text").sort({ sendAt: -1 }).limit(300).lean();
    const forms = new Map((await Form.find({ _id: { $in: [...new Set(list.map((m) => m.form).filter(Boolean).map(String))] } }).select("title").lean()).map((f) => [String(f._id), f.title]));
    res.json({ emails: list.map((m) => {
      const formTitle = m.form ? forms.get(String(m.form)) || "" : "";
      // {{Form title}} is the same for everyone, so the list shows it filled in.
      return { ...listOut(m), subject: formTitle ? vars.fillText(m.subject, { "Form title": formTitle }) : m.subject, formTitle };
    }) });
  } catch (err) { sendError(err, res, next); }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Email not found.", 404);
    const m = await EmailMessage.findById(req.params.id).lean();
    if (!m) throw new InputError("Email not found.", 404);
    res.json({
      email: {
        ...listOut(m), html: m.html, cc: m.cc || [], bcc: m.bcc || [], greeting: m.greeting !== false,
        copy: m.copy && m.copy.status !== "none" ? { status: m.copy.status, error: m.copy.error || "", sentAt: m.copy.sentAt || null } : null,
        templateName: m.templateName || "",
        form: m.form ? await Form.findById(m.form).select("title code").lean().then((f) => (f ? { title: f.title, code: f.code } : null)) : null,
        attachments: (m.files || []).map((f) => ({ name: f.name, size: f.size, type: f.type, url: storage.signedUrl(f) })),
        recipients: m.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, place: r.place || "", status: r.status, provider: r.provider || "", error: r.error || "", sentAt: r.sentAt || null, notified: !!r.notified })),
        cancelledBy: m.cancelledBy ? { name: m.cancelledBy.name, email: m.cancelledBy.email } : null,
      },
    });
  } catch (err) { sendError(err, res, next); }
});

router.post("/:id/cancel", async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Email not found.", 404);
    const m = await EmailMessage.findOneAndUpdate({ _id: req.params.id, status: "scheduled" }, { $set: { status: "cancelled", cancelledBy: me(req), finishedAt: new Date() } }, { returnDocument: "after" }).lean();
    if (!m) throw new InputError("Only an email that hasn't started sending can be cancelled.", 409);
    audit(req, "email_cancelled", { target: target(m) });
    res.json({ email: listOut(m) });
  } catch (err) { sendError(err, res, next); }
});

router.post("/:id/retry", sendLimiter, async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new InputError("Email not found.", 404);
    const m = await EmailMessage.findById(req.params.id);
    const copyFailed = !!(m && m.copy && m.copy.status === "failed");
    if (!m || !["done", "failed"].includes(m.status) || (!m.failed && !copyFailed)) throw new InputError("There is nothing to send again.", 409);
    let n = 0;
    m.recipients.forEach((r) => { if (r.status === "failed") { r.status = "pending"; r.error = ""; n += 1; } });
    if (copyFailed) { m.copy.status = "pending"; m.copy.error = ""; }
    m.failed = 0;
    m.status = "scheduled";
    m.sendAt = new Date();
    m.finishedAt = undefined;
    await m.save();
    audit(req, "email_sent", { target: target(m), details: { retry: true, recipients: n } });
    kick();
    res.json({ email: listOut(m.toObject()) });
  } catch (err) { sendError(err, res, next); }
});

// ---------- provider settings (Super Admin) ----------
router.get("/settings/providers", admin, async (req, res, next) => {
  try { res.json(await mail.status()); } catch (err) { sendError(err, res, next); }
});
router.put("/settings/providers", admin, async (req, res, next) => {
  try {
    const name = String((req.body || {}).provider || "");
    if (!mail.NAMES.includes(name)) throw new InputError("Choose Nodemailer or SendGrid.");
    const before = await mail.activeName();
    await mail.setActive(name, req.user.email);
    audit(req, "email_settings_changed", { target: { type: "settings", id: "email.provider", label: "Email provider" }, changes: [{ field: "provider", label: "Email provider", from: before, to: name }] });
    res.json(await mail.status());
  } catch (err) { sendError(err, res, next); }
});
router.post("/settings/test", admin, sendLimiter, async (req, res, next) => {
  try {
    const name = String((req.body || {}).provider || "");
    if (!mail.NAMES.includes(name)) throw new InputError("Choose Nodemailer or SendGrid.");
    const p = mail.PROVIDERS[name];
    try {
      await mail.sendMail({
        to: req.user.email, subject: `Test email (${p.label}) — Umoor Sehhat`,
        text: `This is a test email sent with ${p.label} from the Umoor Sehhat portal. If you can read this, it works.`,
        html: `<p>This is a test email sent with <b>${mail.esc(p.label)}</b> from the Umoor Sehhat portal.</p><p>If you can read this, it works.</p>`,
      }, { provider: name });
    } catch (e) { throw new InputError(`The test email couldn't be sent with ${p.label}: ${String((e && e.message) || e).slice(0, 300)}`, 502); }
    res.json({ ok: true, to: req.user.email });
  } catch (err) { sendError(err, res, next); }
});

/** Attachments never sent with an email are removed after a day. */
async function cleanupFiles() {
  if (!isDbReady()) return;
  const old = await EmailFile.find({ used: false, createdAt: { $lt: new Date(Date.now() - 24 * 3600 * 1000) } }).select("fileId").limit(200).lean();
  for (const f of old) {
    try { await storage.deleteImage(f.fileId); await EmailFile.deleteOne({ _id: f._id }); } catch { /* next time */ }
  }
}
function startFileCleanup() {
  const t = setInterval(() => cleanupFiles().catch(() => {}), 60 * 60 * 1000);
  t.unref();
}

module.exports = router;
module.exports.startFileCleanup = startFileCleanup;
