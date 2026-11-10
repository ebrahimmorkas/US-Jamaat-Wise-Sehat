// JC users (Super Admin only). A JC is just a Gmail address for now; JC sign-in comes later.
const express = require("express");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const User = require("../models/User");
const Session = require("../models/Session");
const { audit } = require("../services/audit");
const { parseGmail } = require("../lib/gmail");
const { InputError, requireId, sendError } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const DUPLICATE = "This Gmail is already added (Gmail ignores dots and “+…”, so it may be written differently).";
const out = (u) => ({ id: String(u._id), email: u.email, isActive: u.isActive, createdAt: u.createdAt, createdBy: u.createdBy || "" });

function gmailOrThrow(input) {
  const g = parseGmail(input);
  if (g.error) throw new InputError(g.error);
  return g;
}

async function findJc(id) {
  const u = await User.findOne({ _id: requireId(id, "user"), role: "jc" });
  if (!u) throw new InputError("User not found.", 404);
  return u;
}

// ---------- GET /api/users ----------
router.get("/", async (req, res, next) => {
  try {
    const users = await User.find({ role: "jc" }).sort({ email: 1 }).lean();
    res.json({ users: users.map(out) });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/users  { email } ----------
router.post("/", async (req, res, next) => {
  try {
    const { email, emailKey } = gmailOrThrow((req.body || {}).email);
    if (await User.exists({ emailKey })) throw new InputError(DUPLICATE, 409);
    const u = await User.create({ role: "jc", email, emailKey, createdBy: req.user.username });
    audit(req, "user_created", { details: { role: "jc", email } });
    res.status(201).json({ user: out(u) });
  } catch (err) {
    sendError(err, res, next, DUPLICATE);
  }
});

// ---------- PATCH /api/users/:id  { email?, isActive? } ----------
router.patch("/:id", async (req, res, next) => {
  try {
    const body = req.body || {};
    const u = await findJc(req.params.id);
    const changes = {};
    if ("email" in body) {
      const { email, emailKey } = gmailOrThrow(body.email);
      if (email !== u.email) {
        if (await User.exists({ emailKey, _id: { $ne: u._id } })) throw new InputError(DUPLICATE, 409);
        changes.email = { from: u.email, to: email };
        u.email = email;
        u.emailKey = emailKey;
      }
    }
    if ("isActive" in body) {
      if (typeof body.isActive !== "boolean") throw new InputError("isActive must be true or false.");
      if (body.isActive !== u.isActive) changes.isActive = { from: u.isActive, to: body.isActive };
      u.isActive = body.isActive;
    }
    await u.save();
    if (changes.isActive && !u.isActive) {
      await Session.updateMany({ user: u._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "deactivated" } });
    }
    if (Object.keys(changes).length) audit(req, "user_updated", { details: { email: u.email, changes } });
    res.json({ user: out(u) });
  } catch (err) {
    sendError(err, res, next, DUPLICATE);
  }
});

// ---------- DELETE /api/users/:id ----------
router.delete("/:id", async (req, res, next) => {
  try {
    const u = await findJc(req.params.id);
    await Session.deleteMany({ user: u._id });
    await u.deleteOne();
    audit(req, "user_deleted", { details: { role: "jc", email: u.email } });
    res.status(204).end();
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
