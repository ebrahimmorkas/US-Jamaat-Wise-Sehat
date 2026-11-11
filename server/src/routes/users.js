// Users (Super Admin only). Every user = a Gmail address + a role; they sign in with that Google account.
//   jc         also has the Jamiats / Jamaats they may fill
//   saheb      dashboard
//   superadmin this portal
// Safety: a Super Admin can't deactivate, delete or demote themselves, and the last active Super Admin stays.
const express = require("express");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const User = require("../models/User");
const { ROLES } = require("../models/User");
const Session = require("../models/Session");
const { audit, diff } = require("../services/audit");
const { parseGmail } = require("../lib/gmail");
const { parseAssignment, countAllAccess, grantToAllAccess, accessChanges } = require("../services/access");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const { InputError, requireId, sendError } = require("../lib/validate");
const realtime = require("../realtime");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const DUPLICATE = "This Gmail is already added (Gmail ignores dots and “+…”, so it may be written differently).";
const out = (u) => ({
  id: String(u._id),
  role: u.role,
  email: u.email || "",
  name: u.name || "",
  username: u.username || "",
  isActive: u.isActive,
  jamiats: (u.jamiats || []).map(String),
  jamaats: (u.jamaats || []).map(String),
  lastLoginAt: u.lastLoginAt || null,
  createdAt: u.createdAt,
  createdBy: u.createdBy || "",
});
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const ROLE_LABELS = { jc: "JC", saheb: "Saheb", superadmin: "Super Admin" };
const USER_FIELDS = [["email", "Gmail"], ["role", "Role", (r) => (r ? ROLE_LABELS[r] || r : r)], ["isActive", "Active"]];
const userTarget = (u) => ({ type: "user", id: String(u._id), label: u.email || u.username });
const accessOf = (u) => ({ jamiats: (u.jamiats || []).map(String), jamaats: (u.jamaats || []).map(String) });

function gmailOrThrow(input) {
  const g = parseGmail(input);
  if (g.error) throw new InputError(g.error);
  return g;
}
function roleOrThrow(role) {
  if (!ROLES.includes(role)) throw new InputError("Choose a role.");
  return role;
}
async function findUser(id) {
  const u = await User.findById(requireId(id, "user"));
  if (!u) throw new InputError("User not found.", 404);
  return u;
}
// Refuse changes that would leave nobody able to manage the site.
async function guardSuperAdmin(req, u, { deactivate, demote, remove }) {
  if (u.role !== "superadmin" || !(deactivate || demote || remove)) return;
  if (String(u._id) === req.user.id) {
    throw new InputError(remove ? "You can't delete your own account." : deactivate ? "You can't deactivate your own account." : "You can't change your own role.", 409);
  }
  const others = await User.countDocuments({ role: "superadmin", isActive: true, _id: { $ne: u._id } });
  if (!others) throw new InputError("At least one active Super Admin must remain.", 409);
}

// ---------- GET /api/users ----------
router.get("/", async (req, res, next) => {
  try {
    const users = await User.find().sort({ role: 1, email: 1 }).lean();
    res.json({ users: users.map(out), me: req.user.id });
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
    const doc = await (type === "jamiat" ? Jamiat : Jamaat).findById(requireId(id, type)).select("name").lean();
    const n = await grantToAllAccess(type, id);
    audit(req, "user_updated", { target: { type, id: String(id), label: doc ? doc.name : String(id) }, details: { op: `new ${type} given to JCs who had access to everything`, users: n } });
    res.json({ updated: n });
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/users  { email, role, jamiats?, jamaats? } ----------
router.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const role = roleOrThrow(body.role || "jc");
    const { email, emailKey } = gmailOrThrow(body.email);
    if (await User.exists({ emailKey })) throw new InputError(DUPLICATE, 409);
    const access = role === "jc" ? await parseAssignment(body) : {};
    const u = await User.create({ role, email, emailKey, ...access, createdBy: req.user.email });
    audit(req, "user_created", {
      target: userTarget(u),
      changes: [...diff(null, u, USER_FIELDS), ...(role === "jc" ? await accessChanges(null, access) : [])],
    });
    res.status(201).json({ user: out(u) });
  } catch (err) {
    sendError(err, res, next, DUPLICATE);
  }
});

// ---------- PATCH /api/users/:id  { email?, role?, isActive?, jamiats?, jamaats? } ----------
router.patch("/:id", async (req, res, next) => {
  try {
    const body = req.body || {};
    const u = await findUser(req.params.id);
    const before = { email: u.email, role: u.role, isActive: u.isActive, ...accessOf(u) };
    const changes = {};
    const newRole = "role" in body ? roleOrThrow(body.role) : u.role;
    await guardSuperAdmin(req, u, {
      deactivate: "isActive" in body && body.isActive === false && u.isActive,
      demote: newRole !== u.role,
    });

    if ("email" in body) {
      const { email, emailKey } = gmailOrThrow(body.email);
      if (email !== u.email) {
        if (await User.exists({ emailKey, _id: { $ne: u._id } })) throw new InputError(DUPLICATE, 409);
        changes.email = { from: u.email || null, to: email };
        u.email = email;
        u.emailKey = emailKey;
        u.googleSub = undefined; // a different Google account will sign in now
      }
    }
    if (newRole !== u.role) {
      changes.role = { from: u.role, to: newRole };
      u.role = newRole;
    }
    if (u.role === "jc") {
      if ("jamiats" in body || "jamaats" in body || changes.role) {
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
    } else {
      u.jamiats = undefined;
      u.jamaats = undefined;
    }
    if ("isActive" in body) {
      if (typeof body.isActive !== "boolean") throw new InputError("isActive must be true or false.");
      if (body.isActive !== u.isActive) changes.isActive = { from: u.isActive, to: body.isActive };
      u.isActive = body.isActive;
    }
    await u.save();
    // Role, Gmail or status changed: sign this user out everywhere.
    if (changes.role || changes.email || (changes.isActive && !u.isActive)) {
      await Session.updateMany({ user: u._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "changed_by_superadmin" } });
      realtime.disconnectUser(u._id); // and close their live connections
    }
    const trail = [...diff(before, u, USER_FIELDS), ...(await accessChanges(before, u.role === "jc" ? accessOf(u) : {}))];
    if (trail.length) audit(req, "user_updated", { target: userTarget(u), changes: trail });
    res.json({ user: out(u) });
  } catch (err) {
    sendError(err, res, next, DUPLICATE);
  }
});

// ---------- DELETE /api/users/:id ----------
router.delete("/:id", async (req, res, next) => {
  try {
    const u = await findUser(req.params.id);
    await guardSuperAdmin(req, u, { remove: true });
    await Session.deleteMany({ user: u._id });
    await u.deleteOne();
    realtime.disconnectUser(u._id);
    audit(req, "user_deleted", { target: userTarget(u), changes: [...diff(u, null, USER_FIELDS), ...(u.role === "jc" ? await accessChanges(accessOf(u), null) : [])] });
    res.status(204).end();
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
