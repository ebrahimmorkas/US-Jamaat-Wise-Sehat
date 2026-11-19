// JC "Metrics": permanent work a JC handles (free text, as many as needed).
//   JC:                 GET /mine, POST / { text }, PATCH /:id { text }, DELETE /:id   (only their own)
//   Saheb, Super Admin: GET /   every active JC with their metrics and star rating (Saheb: name + Jamiats only, no email)
//   Super Admin:        PUT /rating/:userId { stars: 1-5 | null }   (JCs never see ratings)
const express = require("express");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const User = require("../models/User");
const Jamiat = require("../models/Jamiat");
const JcMetric = require("../models/JcMetric");
const JcRating = require("../models/JcRating");
const { audit } = require("../services/audit");
const { InputError, requireId, sendError } = require("../lib/validate");
const { publish } = require("../realtime");
const { TOPICS, EVENTS } = require("../realtime/topics");
const { notDeleted } = require("../lib/softDelete");

const MAX_PER_JC = 50;
const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const out = (m) => ({ id: String(m._id), text: m.text, createdAt: m.createdAt, updatedAt: m.updatedAt });
const changed = () => publish(TOPICS.dashboard, EVENTS.metricsChanged, { reason: "metrics" });

function parseText(v) {
  const text = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (!text) throw new InputError("Write the metric.");
  if (text.length > 300) throw new InputError("A metric can be at most 300 characters.");
  return text;
}
async function notTwice(user, text, exceptId) {
  const mine = await JcMetric.find({ user, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select("text").lean();
  if (mine.some((m) => m.text.toLowerCase() === text.toLowerCase())) throw new InputError("You have already added this metric.");
  return mine.length;
}
async function ownMetric(req) {
  const id = requireId(req.params.id, "metric");
  const m = await JcMetric.findById(id);
  if (!m || String(m.user) !== String(req.user.id)) throw new InputError("This metric was not found. Reload the page.", 404);
  return m;
}

// ---------- JC ----------
router.get("/mine", requireRole("jc"), async (req, res, next) => {
  try {
    const list = await JcMetric.find({ user: req.user.id }).sort({ createdAt: 1 }).lean();
    res.json({ metrics: list.map(out) });
  } catch (err) { next(err); }
});

router.post("/", requireRole("jc"), async (req, res, next) => {
  try {
    const text = parseText(req.body && req.body.text);
    const count = await notTwice(req.user.id, text);
    if (count >= MAX_PER_JC) throw new InputError(`At most ${MAX_PER_JC} metrics.`);
    const m = await JcMetric.create({ user: req.user.id, text });
    audit(req, "metric_added", { target: { type: "metric", id: String(m._id), label: text }, changes: [{ field: "text", label: "Metric", from: null, to: text }] });
    changed();
    res.status(201).json(out(m));
  } catch (err) { sendError(err, res, next); }
});

router.patch("/:id", requireRole("jc"), async (req, res, next) => {
  try {
    const m = await ownMetric(req);
    const text = parseText(req.body && req.body.text);
    if (text !== m.text) {
      await notTwice(req.user.id, text, m._id);
      const from = m.text;
      m.text = text;
      await m.save();
      audit(req, "metric_updated", { target: { type: "metric", id: String(m._id), label: text }, changes: [{ field: "text", label: "Metric", from, to: text }] });
      changed();
    }
    res.json(out(m));
  } catch (err) { sendError(err, res, next); }
});

router.delete("/:id", requireRole("jc"), async (req, res, next) => {
  try {
    const m = await ownMetric(req);
    await m.deleteOne();
    audit(req, "metric_deleted", { target: { type: "metric", id: String(m._id), label: m.text }, changes: [{ field: "text", label: "Metric", from: m.text, to: null }] });
    changed();
    res.json({ ok: true });
  } catch (err) { sendError(err, res, next); }
});

// ---------- Saheb / Super Admin ----------
router.get("/", requireRole("saheb", "superadmin"), async (req, res, next) => {
  try {
    const admin = req.user.role === "superadmin";
    const [jcs, metrics, jamiats, ratings] = await Promise.all([
      User.find({ role: "jc", isActive: true, ...notDeleted() }).select("name email jamiats").lean(),
      JcMetric.find({}).sort({ createdAt: 1 }).lean(),
      Jamiat.find(notDeleted()).select("name").lean(),
      JcRating.find({}).select("user stars updatedAt").lean(),
    ]);
    const stars = new Map(ratings.map((r) => [String(r.user), r]));
    const jName = new Map(jamiats.map((j) => [String(j._id), j.name]));
    const byUser = new Map();
    for (const m of metrics) {
      const k = String(m.user);
      if (!byUser.has(k)) byUser.set(k, []);
      byUser.get(k).push(out(m));
    }
    const list = jcs
      .map((u) => ({
        id: String(u._id),
        name: u.name || (admin ? u.email : "JC (no name set)"),
        ...(admin ? { email: u.email } : {}),
        jamiats: (u.jamiats || []).map((id) => jName.get(String(id))).filter(Boolean).sort(),
        metrics: byUser.get(String(u._id)) || [],
        stars: stars.has(String(u._id)) ? stars.get(String(u._id)).stars : null,
        ratedAt: stars.has(String(u._id)) ? stars.get(String(u._id)).updatedAt : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ jcs: list, total: list.reduce((n, u) => n + u.metrics.length, 0) });
  } catch (err) { next(err); }
});

router.put("/rating/:userId", requireRole("superadmin"), async (req, res, next) => {
  try {
    const id = requireId(req.params.userId, "JC");
    const jc = await User.findOne({ _id: id, role: "jc", ...notDeleted() }).select("name email").lean();
    if (!jc) throw new InputError("This JC was not found. Reload the page.", 404);
    const raw = req.body ? req.body.stars : undefined;
    const stars = raw === null || raw === 0 ? null : Number(raw);
    if (stars !== null && !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) throw new InputError("Choose 1 to 5 stars.");
    const before = await JcRating.findOne({ user: id }).lean();
    const from = before ? before.stars : null;
    if (from !== stars) {
      if (stars === null) await JcRating.deleteOne({ user: id });
      else await JcRating.updateOne({ user: id }, { $set: { stars, ratedBy: req.user.id } }, { upsert: true });
      audit(req, "jc_rated", {
        target: { type: "user", id: String(id), label: jc.name || jc.email },
        changes: [{ field: "stars", label: "Star rating", from: from ? `${from} ★` : null, to: stars ? `${stars} ★` : null }],
      });
      changed();
    }
    res.json({ id: String(id), stars });
  } catch (err) { sendError(err, res, next); }
});

module.exports = router;
