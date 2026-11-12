// Simple dropdown lists (Super Admin only) — currently the Mauze Type list.
//  - Values are saved in capitals; duplicates (ignoring capitals/spaces) are refused.
//  - Renaming a value also renames it in every Jamaat; a value in use can't be removed.
//  - Removing a value only sets status "D" (hidden, kept, restorable).
const express = require("express");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const OptionList = require("../models/OptionList");
const Jamaat = require("../models/Jamaat");
const { audit } = require("../services/audit");
const listTarget = (key) => ({ type: "list", id: key, label: (form.lists[key] || {}).label || key });
const { invalidate } = require("../services/lists");
const { isDeleted, markDeleted, markRestored, deletedInfo } = require("../lib/softDelete");
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

function findValue(doc, id, { allowDeleted = false } = {}) {
  const v = isId(id) ? doc.values.id(id) : null;
  if (!v) throw new InputError("Value not found. Reload the page.", 404);
  if (!allowDeleted && isDeleted(v)) throw new InputError(`"${v.value}" is deleted. Restore it first to change it.`, 409);
  return v;
}
const liveValues = (doc) => doc.values.filter((v) => !isDeleted(v));
// Values are unique in a list, deleted ones included (restore one instead of adding it again).
function checkValueFree(doc, value, exceptId) {
  const hit = doc.values.find((v) => String(v._id) !== String(exceptId || "") && norm(v.value) === norm(value));
  if (!hit) return;
  throw new InputError(isDeleted(hit)
    ? `"${hit.value}" was deleted from this list earlier. Click “Show deleted” and restore it instead.`
    : `"${value}" is already in this list.`, 409);
}

// Every value with its usage; deleted ones (status "D") flagged so the screen can offer Restore.
async function listsPayload() {
  invalidate();
  const [docs, used] = await Promise.all([OptionList.find({ key: { $in: Object.keys(form.lists) } }).lean(), usage()]);
  return {
    lists: Object.entries(form.lists).map(([key, def]) => {
      const doc = docs.find((d) => d.key === key);
      return {
        key,
        label: def.label,
        usedBy: def.usedBy || [],
        values: (doc ? doc.values : []).map((v) => ({ id: String(v._id), value: v.value, inUse: used.get(v.value) || 0, ...deletedInfo(v) })),
      };
    }),
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
    checkValueFree(doc, value);
    doc.values.push({ value });
    await doc.save();
    audit(req, "dropdown_updated", { target: listTarget(req.params.key), changes: [{ field: "values", label: "Value added", from: null, to: value }] });
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
    checkValueFree(doc, value, item._id);
    let renamed = 0;
    if (value !== before) renamed = (await Jamaat.updateMany({ mauzeType: before }, { $set: { mauzeType: value } })).modifiedCount;
    item.value = value;
    await doc.save();
    if (value !== before) audit(req, "dropdown_updated", { target: listTarget(req.params.key), changes: [{ field: "value", label: "Value", from: before, to: value }], details: renamed ? { jamaatsRenamed: renamed } : undefined });
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
    if (liveValues(doc).length <= 1) throw new InputError("The list needs at least 1 value.", 409);
    const n = (await usage()).get(item.value) || 0;
    if (n) throw new InputError(`"${item.value}" is used by ${n} Jamaat${n === 1 ? "" : "s"}, so it can't be removed. Rename it instead.`, 409);
    markDeleted(item, req.user.email); // status "D": hidden from the dropdowns, kept
    await doc.save();
    audit(req, "dropdown_updated", { target: listTarget(req.params.key), changes: [{ field: "values", label: "Value deleted (status D)", from: item.value, to: null }] });
    res.json(await listsPayload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/settings/lists/:key/values/:id/restore ----------
router.post("/lists/:key/values/:id/restore", async (req, res, next) => {
  try {
    const doc = await loadDoc(req.params.key);
    const item = findValue(doc, req.params.id, { allowDeleted: true });
    if (!isDeleted(item)) throw new InputError(`"${item.value}" is not deleted.`, 409);
    checkValueFree(doc, item.value, item._id);
    markRestored(item);
    await doc.save();
    audit(req, "dropdown_updated", { target: listTarget(req.params.key), changes: [{ field: "values", label: "Value restored", from: null, to: item.value }] });
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
    const current = liveValues(doc).map((v) => String(v._id));
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw new InputError("The list changed meanwhile. Reload the page.", 409);
    }
    const byId = new Map(doc.values.map((v) => [String(v._id), v.toObject()]));
    const beforeOrder = liveValues(doc).map((v) => v.value);
    doc.values = [...ids.map((id) => byId.get(id)), ...doc.values.filter((v) => isDeleted(v)).map((v) => v.toObject())];
    await doc.save();
    audit(req, "dropdown_updated", { target: listTarget(req.params.key), changes: [{ field: "order", label: "Order", from: beforeOrder, to: liveValues(doc).map((v) => v.value) }] });
    res.json(await listsPayload());
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
