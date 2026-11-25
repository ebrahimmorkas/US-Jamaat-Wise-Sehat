// The Jamaat Coordinator's portal: /api/coordinator — only their own data.
//   GET  /responses             everything they have submitted (with the form, shown like the filled form)
//   GET  /notifications         their notifications (newest first) + how many are unread
//   GET  /unread                just the unread count (for the badge)
//   POST /notifications/read    { id } one, or {} all -> read
//   GET  /profile               who they are (read-only: the Super Admin changes it)
// Their forms ("My forms") are GET /api/forms/mine.
const express = require("express");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const Form = require("../models/Form");
const FormResponse = require("../models/FormResponse");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { InputError, sendError } = require("../lib/validate");
const { notDeleted } = require("../lib/softDelete");
const F = require("../services/forms");
const { layoutOf, topImageOf, responsesOut } = require("../services/formOut");

const router = express.Router();
router.use(requireAuth, requireRole("jamaat_coordinator"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const me = (req) => User.findById(req.user.id).select("email name isTester jamaat createdAt lastLoginAt").lean();
// Their link to a form (personal-link forms: with their Gmail inside).
const linkFor = (f, email) => (f.access === "personal_link" ? F.personalLink(f.code, email) : F.formLink(f.code));
// Can they still change their answers? (the form is open and allows editing)
const canEdit = (f, isTester) => !!f.allowEdit && (F.stateOf(f) === "open" || (isTester && f.stage === "testing"));

router.get("/responses", async (req, res, next) => {
  try {
    const u = await me(req);
    const list = await FormResponse.find({ emailKey: F.emailKeyOf(u.email), ...(u.isTester ? {} : { isTest: false }) })
      .sort({ createdAt: -1 }).limit(2000).lean();
    const forms = await Form.find({ _id: { $in: [...new Set(list.map((r) => String(r.form)))] }, stage: { $ne: "draft" }, ...notDeleted() }).lean();
    const formOf = new Map(forms.map((f) => [String(f._id), f]));
    const kept = list.filter((r) => formOf.has(String(r.form)));
    const rows = await responsesOut(kept);
    // Each form once (its questions), referred to by its public code.
    const used = new Map();
    kept.forEach((r) => {
      const f = formOf.get(String(r.form));
      if (!used.has(f.code)) {
        used.set(f.code, {
          id: f.code, title: f.title, description: f.description || "", topImage: topImageOf(f), fields: layoutOf(f),
          state: F.stateOf(f), endAt: f.endAt, editLink: canEdit(f, u.isTester) ? linkFor(f, u.email) : "",
        });
      }
    });
    res.json({ forms: [...used.values()], rows: rows.map((r, i) => ({ ...r, form: formOf.get(String(kept[i].form)).code })) });
  } catch (err) { sendError(err, res, next); }
});

const notificationOut = (n, formOf, u) => {
  const f = n.form && formOf.get(String(n.form));
  const fillable = f && (F.stateOf(f) === "open" || (u.isTester && f.stage === "testing"));
  return {
    id: F.seal(n._id), // scrambled: no database ids in the website
    kind: n.kind, title: n.title, body: n.body, at: n.createdAt, read: !!n.readAt,
    form: f ? { title: f.title, endAt: f.endAt, link: fillable ? linkFor(f, u.email) : "" } : null,
  };
};

router.get("/notifications", async (req, res, next) => {
  try {
    const u = await me(req);
    const list = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(300).lean();
    const forms = await Form.find({ _id: { $in: list.map((n) => n.form).filter(Boolean) }, ...notDeleted() })
      .select("title code access stage startAt endAt").lean();
    const formOf = new Map(forms.map((f) => [String(f._id), f]));
    res.json({ notifications: list.map((n) => notificationOut(n, formOf, u)), unread: list.filter((n) => !n.readAt).length });
  } catch (err) { sendError(err, res, next); }
});

router.get("/unread", async (req, res, next) => {
  try { res.json({ unread: await Notification.countDocuments({ user: req.user.id, readAt: null }) }); }
  catch (err) { sendError(err, res, next); }
});

router.post("/notifications/read", async (req, res, next) => {
  try {
    const id = (req.body || {}).id;
    const q = { user: req.user.id, readAt: null };
    if (id != null) {
      const real = F.unseal(id);
      if (!real) throw new InputError("Unknown notification.");
      q._id = real;
    }
    await Notification.updateMany(q, { $set: { readAt: new Date() } });
    res.json({ ok: true, unread: await Notification.countDocuments({ user: req.user.id, readAt: null }) });
  } catch (err) { sendError(err, res, next); }
});

router.get("/profile", async (req, res, next) => {
  try {
    const u = await me(req);
    const jm = u.jamaat ? await Jamaat.findById(u.jamaat).select("name jamiat").lean() : null;
    const jt = jm ? await Jamiat.findById(jm.jamiat).select("name").lean() : null;
    res.json({
      profile: {
        name: u.name || "", email: u.email || "", role: "Jamaat Coordinator",
        jamiat: (jt && jt.name) || "", jamaat: (jm && jm.name) || "",
        isTester: !!u.isTester, since: u.createdAt, lastLoginAt: u.lastLoginAt || null,
      },
    });
  } catch (err) { sendError(err, res, next); }
});

module.exports = router;
