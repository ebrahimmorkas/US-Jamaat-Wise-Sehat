// JC users (Super Admin only). A JC is just a Gmail address for now; JC sign-in comes later.
const express = require("express");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const User = require("../models/User");
const Session = require("../models/Session");
const { audit } = require("../services/audit");
const { parseGmail } = require("../lib/gmail");
const { parseAssignment, countAllAccess, grantToAllAccess } = require("../services/access");
const { InputError, requireId, sendError } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const DUPLICATE = "This Gmail is already added (Gmail ignores dots and “+…”, so it may be written differently).";
const out = (u) => ({
  id: String(u._id),
  email: u.email,
  isActive: u.isActive,
  jamiats: (u.jamiats || []).map(String),
  jamaats: (u.jamaats || []).map(String),
  createdAt: u.createdAt,
  createdBy: u.createdBy || "",
});
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

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

// ---------- GET /api/users/all-access?type=jamiat|jamaat&id=<id> ----------
// How many JCs had access to everything before this new Jamiat / Jamaat was added.
router.get("/all-access", async (req, res, next) => {
  try {
    const { type, id } = req.query;
    if (!["jamiat", "jamaat"].includes(type)) throw new InputError("Unknown type.");
    res.json({ count: await countAllAccess(type, requireId(id, type)) });
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/users/all-access  { type, id } ----------  give it to those JCs
router.post("/all-access", async (req, res, next) => {
  try {
    const { type, id } = req.body || {};
    if (!["jamiat", "jamaat"].includes(type)) throw new InputError("Unknown type.");
    const n = await grantToAllAccess(type, requireId(id, type));
    audit(req, "user_updated", { details: { op: "grant new to all-access JCs", type, id, users: n } });
    res.json({ updated: n });
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/users  { email, jamiats: [ids], jamaats: [ids] } ----------
router.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const { email, emailKey } = gmailOrThrow(body.email);
    if (await User.exists({ emailKey })) throw new InputError(DUPLICATE, 409);
    const access = await parseAssignment(body);
    const u = await User.create({ role: "jc", email, emailKey, ...access, createdBy: req.user.username });
    audit(req, "user_created", { details: { role: "jc", email, jamiats: access.jamiats.length, jamaats: access.jamaats.length } });
    res.status(201).json({ user: out(u) });
  } catch (err) {
    sendError(err, res, next, DUPLICATE);
  }
});

// ---------- PATCH /api/users/:id  { email?, isActive?, jamiats?, jamaats? } ----------
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
    if ("jamiats" in body || "jamaats" in body) {
      const access = await parseAssignment({
        jamiats: "jamiats" in body ? body.jamiats : u.jamiats,
        jamaats: "jamaats" in body ? body.jamaats : u.jamaats,
      });
      const before = { jamiats: (u.jamiats || []).map(String), jamaats: (u.jamaats || []).map(String) };
      if (!sameSet(before.jamiats, access.jamiats) || !sameSet(before.jamaats, access.jamaats)) {
        changes.access = { from: { jamiats: before.jamiats.length, jamaats: before.jamaats.length }, to: { jamiats: access.jamiats.length, jamaats: access.jamaats.length } };
      }
      u.jamiats = access.jamiats;
      u.jamaats = access.jamaats;
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
