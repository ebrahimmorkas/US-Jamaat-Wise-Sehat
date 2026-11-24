// Jamiat and Jamaat masters (Super Admin only).
//  - Names are saved in capitals with single spaces; duplicates are refused.
//  - Delete never removes anything: it sets status "D" (hidden everywhere, kept, restorable).
//  - Something in use cannot be deleted: a Jamiat with Jamaats, or a Jamaat with monthly entries.
//    Mark it inactive instead (it disappears from the portal and the dashboard, history is kept).
const express = require("express");
const { getValueSets } = require("../services/lists");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const Entry = require("../models/Entry");
const { audit, diff } = require("../services/audit");
const { removeFromAccess } = require("../services/access");
const { InputError, requireId, parseName, parseJamaatDetails, sendError } = require("../lib/validate");
const { DELETED, notDeleted, isDeleted, markDeleted, deletedInfo, statusChange } = require("../lib/softDelete");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => {
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
  nameAr: jm.nameAr || "",
  mauzeType: jm.mauzeType || "",
  houseCount: jm.houseCount == null ? null : jm.houseCount,
  children: jm.children == null ? null : jm.children,
  isActive: jm.isActive,
  entryCount,
  ...deletedInfo(jm),
});
const jamiatOut = (j) => ({ id: String(j._id), name: j.name, nameAr: j.nameAr || "", isActive: j.isActive, ...deletedInfo(j) });

// A name used by another record that isn't deleted (a deleted one's name can be used again).
async function checkJamiatName(name, exceptId) {
  if (await Jamiat.exists({ name, ...notDeleted(), ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) throw new InputError(DUP_JAMIAT, 409);
}
async function checkJamaatName(jamiatId, name, exceptId) {
  if (await Jamaat.exists({ jamiat: jamiatId, name, ...notDeleted(), ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) throw new InputError(DUP_JAMAAT, 409);
}
function notDeletedOrThrow(doc) {
  if (isDeleted(doc)) throw new InputError(`${doc.name} is deleted.`, 409);
  return doc;
}

/** Arabic name (shown in reports): single spaces, at most 200 characters; "" = none. */
function parseArabic(v) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (s.length > 200) throw new InputError("The Arabic name is too long (max 200 characters).");
  return s;
}

function parseActive(v) {
  if (typeof v !== "boolean") throw new InputError("isActive must be true or false.");
  return v;
}

// Audit trail: which fields are compared, with readable labels.
const JAMIAT_FIELDS = [["name", "Name"], ["nameAr", "Arabic name"], ["isActive", "Active"]];
const JAMAAT_FIELDS = [["jamiatName", "Jamiat"], ["name", "Name"], ["nameAr", "Arabic name"], ["mauzeType", "Mauze Type"], ["houseCount", "House Count"], ["children", "Children"], ["isActive", "Active"]];
const jamiatTarget = (j) => ({ type: "jamiat", id: String(j._id), label: j.name });
const jamaatTarget = (jm, jamiatName) => ({ type: "jamaat", id: String(jm._id), label: `${jm.name} (${jamiatName})` });
// Plain copy of a Jamaat with its Jamiat's name (so the trail shows names, not ids).
async function jamaatSnapshot(jm) {
  const j = await Jamiat.findById(jm.jamiat).select("name").lean();
  return { ...(jm.toObject ? jm.toObject() : jm), jamiatName: j ? j.name : String(jm.jamiat) };
}

// ---------- GET /api/masters ----------
router.get("/", async (req, res, next) => {
  try {
    const [jamiats, jamaats, counts] = await Promise.all([
      Jamiat.find(notDeleted()).sort({ name: 1 }).lean(),
      Jamaat.find(notDeleted()).sort({ name: 1 }).lean(),
      Entry.aggregate([{ $group: { _id: "$jamaat", n: { $sum: 1 } } }]),
    ]);
    const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      mauzeTypes: (await getValueSets()).mauzeType,
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
    await checkJamiatName(name);
    const j = await Jamiat.create({ name, nameAr: parseArabic((req.body || {}).nameAr) });
    audit(req, "master_created", { target: jamiatTarget(j), changes: diff(null, j, JAMIAT_FIELDS) });
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
    notDeletedOrThrow(j);
    const before = j.toObject();
    if ("name" in body) {
      j.name = parseName(body.name, "Jamiat", 80);
      if (j.name !== before.name) await checkJamiatName(j.name, j._id);
    }
    if ("nameAr" in body) j.nameAr = parseArabic(body.nameAr);
    if ("isActive" in body) j.isActive = parseActive(body.isActive);
    await j.save();
    const changes = diff(before, j, JAMIAT_FIELDS);
    if (changes.length) audit(req, "master_updated", { target: jamiatTarget(j), changes });
    res.json({ jamiat: jamiatOut(j) });
  } catch (err) {
    sendError(err, res, next, DUP_JAMIAT);
  }
});

router.delete("/jamiats/:id", async (req, res, next) => {
  try {
    const j = await Jamiat.findById(requireId(req.params.id, "Jamiat"));
    if (!j) throw new InputError("Jamiat not found.", 404);
    if (isDeleted(j)) throw new InputError(`${j.name} is already deleted.`, 409);
    const n = await Jamaat.countDocuments({ jamiat: j._id, ...notDeleted() });
    if (n) throw new InputError(`${j.name} still has ${n} Jamaat${n === 1 ? "" : "s"}. Delete or move them first, or mark the Jamiat inactive.`, 409);
    const before = j.toObject();
    markDeleted(j, req.user.email);
    await j.save();
    await removeFromAccess("jamiat", j._id);
    audit(req, "master_deleted", { target: jamiatTarget(j), changes: [statusChange("A", DELETED), ...diff(before, j, JAMIAT_FIELDS)] });
    res.status(204).end();
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- Jamaats ----------
async function findJamiat(id) {
  const j = await Jamiat.findById(requireId(id, "Jamiat")).select("name status").lean();
  if (!j) throw new InputError("Jamiat not found.", 404);
  if (isDeleted(j)) throw new InputError(`The Jamiat ${j.name} is deleted.`, 409);
  return j;
}

router.post("/jamaats", async (req, res, next) => {
  try {
    const body = req.body || {};
    const jamiat = await findJamiat(body.jamiatId);
    const name = parseName(body.name, "Jamaat", 120);
    await checkJamaatName(jamiat._id, name);
    const jm = await Jamaat.create({ jamiat: jamiat._id, name, nameAr: parseArabic(body.nameAr), ...parseJamaatDetails(body, (await getValueSets()).mauzeType) });
    audit(req, "master_created", { target: jamaatTarget(jm, jamiat.name), changes: diff(null, { ...jm.toObject(), jamiatName: jamiat.name }, JAMAAT_FIELDS) });
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
    notDeletedOrThrow(jm);
    const before = await jamaatSnapshot(jm);
    if ("jamiatId" in body) jm.jamiat = (await findJamiat(body.jamiatId))._id;
    if ("name" in body) jm.name = parseName(body.name, "Jamaat", 120);
    if (jm.name !== before.name || String(jm.jamiat) !== String(before.jamiat)) await checkJamaatName(jm.jamiat, jm.name, jm._id);
    if ("nameAr" in body) jm.nameAr = parseArabic(body.nameAr);
    if ("isActive" in body) jm.isActive = parseActive(body.isActive);
    Object.assign(jm, parseJamaatDetails(body, (await getValueSets()).mauzeType));
    await jm.save();
    const after = await jamaatSnapshot(jm);
    const changes = diff(before, after, JAMAAT_FIELDS);
    if (changes.length) audit(req, "master_updated", { target: jamaatTarget(jm, after.jamiatName), changes });
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
    if (isDeleted(jm)) throw new InputError(`${jm.name} is already deleted.`, 409);
    const n = await Entry.countDocuments({ jamaat: jm._id });
    if (n) throw new InputError(`${jm.name} has ${n} monthly entr${n === 1 ? "y" : "ies"}, so it can't be deleted. Mark it inactive instead.`, 409);
    const before = await jamaatSnapshot(jm);
    markDeleted(jm, req.user.email);
    await jm.save();
    await removeFromAccess("jamaat", jm._id);
    audit(req, "master_deleted", { target: jamaatTarget(jm, before.jamiatName), changes: [statusChange("A", DELETED), ...diff(before, await jamaatSnapshot(jm), JAMAAT_FIELDS)] });
    res.status(204).end();
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
