// Simple dropdown lists (Super Admin only) — currently the Mauze Type list.
//  - Values are saved in capitals; duplicates (ignoring capitals/spaces) are refused.
//  - Renaming a value also renames it in every Jamaat; a value in use can't be removed.
const express = require("express");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const OptionList = require("../models/OptionList");
const Jamaat = require("../models/Jamaat");
const { audit } = require("../services/audit");
const { getLists, invalidate } = require("../services/lists");
const { cleanName } = require("../lib/names");
const { InputError, isId, sendError } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

function listDef(key) {
  const def = form.lists[key];
  if (!def) throw new InputError("Unknown list.", 404);
  return def;
}

function cleanValue(v) {
  const s = cleanName(v);
  if (!s) throw new InputError("Enter a value.");
  if (s.length > 40) throw new InputError("Keep the value under 40 characters.");
  return s;
}

// Mauze Type usage = Jamaats with that type.
async function usage() {
  const rows = await Jamaat.aggregate([{ $group: { _id: "$mauzeType", n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

async function loadDoc(key) {
  listDef(key);
  const doc = await OptionList.findOne({ key });
  if (!doc) throw new InputError("List not found.", 404);
  return doc;
}

function findValue(doc, id) {
  const v = isId(id) ? doc.values.id(id) : null;
  if (!v) throw new InputError("Value not found. Reload the page.", 404);
  return v;
}

async function listsPayload() {
  invalidate();
  const [lists, used] = await Promise.all([getLists(), usage()]);
  return {
    lists: Object.entries(form.lists).map(([key, def]) => ({
      key,
      label: def.label,
      usedBy: def.usedBy || [],
      values: lists[key].map((v) => ({ ...v, inUse: used.get(v.value) || 0 })),
    })),
  };
}

// ---------- GET /api/settings/lists ----------
router.get("/lists", async (req, res, next) => {
  try {
    res.json(await listsPayload());
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/settings/lists/:key/values  { value } ----------
router.post("/lists/:key/values", async (req, res, next) => {
  try {
    const doc = await loadDoc(req.params.key);
    const value = cleanValue((req.body || {}).value);
    if (doc.values.some((v) => norm(v.value) === norm(value))) throw new InputError(`"${value}" is already in this list.`, 409);
    doc.values.push({ value });
    await doc.save();
    audit(req, "dropdown_updated", { details: { list: req.params.key, op: "add", value } });
    res.status(201).json(await listsPayload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PATCH /api/settings/lists/:key/values/:id  { value } ----------
router.patch("/lists/:key/values/:id", async (req, res, next) => {
  try {
    const doc = await loadDoc(req.params.key);
    const item = findValue(doc, req.params.id);
    const before = item.value;
    const value = cleanValue((req.body || {}).value);
    if (doc.values.some((v) => String(v._id) !== String(item._id) && norm(v.value) === norm(value))) {
      throw new InputError(`"${value}" is already in this list.`, 409);
    }
    let renamed = 0;
    if (value !== before) renamed = (await Jamaat.updateMany({ mauzeType: before }, { $set: { mauzeType: value } })).modifiedCount;
    item.value = value;
    await doc.save();
    if (value !== before) audit(req, "dropdown_updated", { details: { list: req.params.key, op: "rename", from: before, to: value, renamedIn: renamed } });
    res.json(await listsPayload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- DELETE /api/settings/lists/:key/values/:id ----------
router.delete("/lists/:key/values/:id", async (req, res, next) => {
  try {
    const doc = await loadDoc(req.params.key);
    const item = findValue(doc, req.params.id);
    if (doc.values.length <= 1) throw new InputError("The list needs at least 1 value.", 409);
    const n = (await usage()).get(item.value) || 0;
    if (n) throw new InputError(`"${item.value}" is used by ${n} Jamaat${n === 1 ? "" : "s"}, so it can't be removed. Rename it instead.`, 409);
    doc.values.pull(item._id);
    await doc.save();
    audit(req, "dropdown_updated", { details: { list: req.params.key, op: "remove", value: item.value } });
    res.json(await listsPayload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PUT /api/settings/lists/:key/order  { ids } ----------
router.put("/lists/:key/order", async (req, res, next) => {
  try {
    const doc = await loadDoc(req.params.key);
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : [];
    const current = doc.values.map((v) => String(v._id));
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw new InputError("The list changed meanwhile. Reload the page.", 409);
    }
    const byId = new Map(doc.values.map((v) => [String(v._id), v.toObject()]));
    doc.values = ids.map((id) => byId.get(id));
    await doc.save();
    audit(req, "dropdown_updated", { details: { list: req.params.key, op: "reorder" } });
    res.json(await listsPayload());
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
