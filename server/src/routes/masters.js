// Jamiat and Jamaat masters (admins only).
//  - Names are saved in capitals with single spaces; duplicates are refused.
//  - Something in use cannot be deleted: a Jamiat with Jamaats, or a Jamaat with monthly entries.
//    Mark it inactive instead (it disappears from the portal and the dashboard, history is kept).
const express = require("express");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const Entry = require("../models/Entry");
const { audit } = require("../services/audit");
const { InputError, requireId, parseName, parseJamaatDetails, sendError } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth, requireRole("admin"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const DUP_JAMIAT = "A Jamiat with this name already exists.";
const DUP_JAMAAT = "This Jamiat already has a Jamaat with this name.";

const jamaatOut = (jm, entryCount = 0) => ({
  id: String(jm._id),
  jamiatId: String(jm.jamiat),
  name: jm.name,
  mauzeType: jm.mauzeType || "",
  houseCount: jm.houseCount == null ? null : jm.houseCount,
  children: jm.children == null ? null : jm.children,
  isActive: jm.isActive,
  entryCount,
});
const jamiatOut = (j) => ({ id: String(j._id), name: j.name, isActive: j.isActive });

function parseActive(v) {
  if (typeof v !== "boolean") throw new InputError("isActive must be true or false.");
  return v;
}

// What changed, for the audit log.
function diff(before, after, keys) {
  const out = {};
  for (const k of keys) if (String(before[k] ?? "") !== String(after[k] ?? "")) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  return out;
}

// ---------- GET /api/masters ----------
router.get("/", async (req, res, next) => {
  try {
    const [jamiats, jamaats, counts] = await Promise.all([
      Jamiat.find().sort({ name: 1 }).lean(),
      Jamaat.find().sort({ name: 1 }).lean(),
      Entry.aggregate([{ $group: { _id: "$jamaat", n: { $sum: 1 } } }]),
    ]);
    const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      mauzeTypes: form.mauzeTypes,
      jamiats: jamiats.map(jamiatOut),
      jamaats: jamaats.map((jm) => jamaatOut(jm, countOf.get(String(jm._id)) || 0)),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Jamiats ----------
router.post("/jamiats", async (req, res, next) => {
  try {
    const name = parseName((req.body || {}).name, "Jamiat", 80);
    const j = await Jamiat.create({ name });
    audit(req, "master_created", { details: { type: "jamiat", name } });
    res.status(201).json({ jamiat: jamiatOut(j) });
  } catch (err) {
    sendError(err, res, next, DUP_JAMIAT);
  }
});

router.patch("/jamiats/:id", async (req, res, next) => {
  try {
    const body = req.body || {};
    const j = await Jamiat.findById(requireId(req.params.id, "Jamiat"));
    if (!j) throw new InputError("Jamiat not found.", 404);
    const before = j.toObject();
    if ("name" in body) j.name = parseName(body.name, "Jamiat", 80);
    if ("isActive" in body) j.isActive = parseActive(body.isActive);
    await j.save();
    const changes = diff(before, j, ["name", "isActive"]);
    if (Object.keys(changes).length) audit(req, "master_updated", { details: { type: "jamiat", name: j.name, changes } });
    res.json({ jamiat: jamiatOut(j) });
  } catch (err) {
    sendError(err, res, next, DUP_JAMIAT);
  }
});

router.delete("/jamiats/:id", async (req, res, next) => {
  try {
    const j = await Jamiat.findById(requireId(req.params.id, "Jamiat"));
    if (!j) throw new InputError("Jamiat not found.", 404);
    const n = await Jamaat.countDocuments({ jamiat: j._id });
    if (n) throw new InputError(`${j.name} still has ${n} Jamaat${n === 1 ? "" : "s"}. Delete or move them first, or mark the Jamiat inactive.`, 409);
    await j.deleteOne();
    audit(req, "master_deleted", { details: { type: "jamiat", name: j.name } });
    res.status(204).end();
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- Jamaats ----------
async function findJamiat(id) {
  const j = await Jamiat.findById(requireId(id, "Jamiat")).select("name").lean();
  if (!j) throw new InputError("Jamiat not found.", 404);
  return j;
}

router.post("/jamaats", async (req, res, next) => {
  try {
    const body = req.body || {};
    const jamiat = await findJamiat(body.jamiatId);
    const name = parseName(body.name, "Jamaat", 120);
    const jm = await Jamaat.create({ jamiat: jamiat._id, name, ...parseJamaatDetails(body) });
    audit(req, "master_created", { details: { type: "jamaat", jamiat: jamiat.name, name } });
    res.status(201).json({ jamaat: jamaatOut(jm) });
  } catch (err) {
    sendError(err, res, next, DUP_JAMAAT);
  }
});

router.patch("/jamaats/:id", async (req, res, next) => {
  try {
    const body = req.body || {};
    const jm = await Jamaat.findById(requireId(req.params.id, "Jamaat"));
    if (!jm) throw new InputError("Jamaat not found.", 404);
    const before = jm.toObject();
    if ("jamiatId" in body) jm.jamiat = (await findJamiat(body.jamiatId))._id;
    if ("name" in body) jm.name = parseName(body.name, "Jamaat", 120);
    if ("isActive" in body) jm.isActive = parseActive(body.isActive);
    Object.assign(jm, parseJamaatDetails(body));
    await jm.save();
    const changes = diff(before, jm, ["jamiat", "name", "mauzeType", "houseCount", "children", "isActive"]);
    if (Object.keys(changes).length) audit(req, "master_updated", { details: { type: "jamaat", name: jm.name, changes } });
    const entryCount = await Entry.countDocuments({ jamaat: jm._id });
    res.json({ jamaat: jamaatOut(jm, entryCount) });
  } catch (err) {
    sendError(err, res, next, DUP_JAMAAT);
  }
});

router.delete("/jamaats/:id", async (req, res, next) => {
  try {
    const jm = await Jamaat.findById(requireId(req.params.id, "Jamaat"));
    if (!jm) throw new InputError("Jamaat not found.", 404);
    const n = await Entry.countDocuments({ jamaat: jm._id });
    if (n) throw new InputError(`${jm.name} has ${n} monthly entr${n === 1 ? "y" : "ies"}, so it can't be deleted. Mark it inactive instead.`, 409);
    await jm.deleteOne();
    audit(req, "master_deleted", { details: { type: "jamaat", name: jm.name } });
    res.status(204).end();
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
