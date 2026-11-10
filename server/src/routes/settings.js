// Dropdown values (Super Admin only): answer choices of the JC form and the Mauze Type list.
//  - Renaming a value also renames it in every saved entry / Jamaat, so history stays correct.
//  - A value that is in use cannot be removed (rename it instead).
//  - Values are unique inside a list (ignoring capitals and extra spaces).
//  - The same answer text must mean the same thing in every list (one colour per answer on the dashboard).
const express = require("express");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const OptionList = require("../models/OptionList");
const { MEANINGS } = require("../models/OptionList");
const Entry = require("../models/Entry");
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

const RESERVED = ["not filled", "other", "all"]; // words the dashboard uses itself
const MIN_VALUES = { answers: 2, plain: 1 };
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
const fieldsUsing = (key) => form.fields.filter((f) => f.statuses === key);

function listDef(key) {
  const def = form.lists[key];
  if (!def) throw new InputError("Unknown list.", 404);
  return def;
}

function cleanValue(def, v) {
  let s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (def.kind === "plain") s = cleanName(s); // Mauze Types are stored in capitals like Jamaat names
  if (!s) throw new InputError("Enter a value.");
  if (s.length > 40) throw new InputError("Keep the value under 40 characters.");
  if (RESERVED.includes(s.toLowerCase())) throw new InputError(`"${s}" is used by the dashboard itself. Choose another word.`);
  return s;
}

function cleanMeaning(def, m) {
  if (def.kind !== "answers") return "";
  if (!MEANINGS.includes(m)) throw new InputError("Choose what this answer means.");
  return m;
}

// Same text in another answer list must have the same meaning.
function checkConsistent(lists, key, value, meaning) {
  for (const [otherKey, def] of Object.entries(form.lists)) {
    if (otherKey === key || def.kind !== "answers") continue;
    const twin = lists[otherKey].find((v) => norm(v.value) === norm(value));
    if (twin && twin.meaning !== meaning) {
      throw new InputError(`"${twin.value}" is already in ${def.label} as "${form.meanings[twin.meaning].label}". Use the same meaning, or a different word.`);
    }
  }
}

// How many saved entries (answer lists) or Jamaats (Mauze Type) use each value.
async function usage(key) {
  const def = listDef(key);
  if (def.kind === "plain") {
    const rows = await Jamaat.aggregate([{ $group: { _id: "$mauzeType", n: { $sum: 1 } } }]);
    return new Map(rows.map((r) => [r._id, r.n]));
  }
  const keys = fieldsUsing(key).map((f) => f.key);
  const rows = await Entry.aggregate([
    { $project: { v: { $objectToArray: "$values" } } },
    { $unwind: "$v" },
    { $match: { "v.k": { $in: keys } } },
    { $group: { _id: "$v.v", n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

async function renameEverywhere(key, from, to) {
  const def = listDef(key);
  if (def.kind === "plain") return (await Jamaat.updateMany({ mauzeType: from }, { $set: { mauzeType: to } })).modifiedCount;
  let n = 0;
  for (const f of fieldsUsing(key)) {
    n += (await Entry.updateMany({ [`values.${f.key}`]: from }, { $set: { [`values.${f.key}`]: to } })).modifiedCount;
  }
  return n;
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

async function respond(res, status = 200) {
  invalidate();
  res.status(status).json(await listsPayload());
}

async function listsPayload() {
  const lists = await getLists();
  const out = [];
  for (const [key, def] of Object.entries(form.lists)) {
    const used = await usage(key);
    out.push({
      key,
      label: def.label,
      kind: def.kind,
      usedBy: def.usedBy || fieldsUsing(key).map((f) => f.label),
      values: lists[key].map((v) => ({ ...v, inUse: used.get(v.value) || 0 })),
    });
  }
  return {
    lists: out,
    meanings: Object.entries(form.meanings).map(([key, m]) => ({ key, label: m.label, tone: m.tone })),
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

// ---------- POST /api/settings/lists/:key/values  { value, meaning } ----------
router.post("/lists/:key/values", async (req, res, next) => {
  try {
    const def = listDef(req.params.key);
    const doc = await loadDoc(req.params.key);
    const value = cleanValue(def, (req.body || {}).value);
    const meaning = cleanMeaning(def, (req.body || {}).meaning);
    if (doc.values.some((v) => norm(v.value) === norm(value))) throw new InputError(`"${value}" is already in this list.`, 409);
    checkConsistent(await getLists(), req.params.key, value, meaning);
    doc.values.push({ value, meaning });
    await doc.save();
    audit(req, "dropdown_updated", { details: { list: req.params.key, op: "add", value, meaning } });
    await respond(res, 201);
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PATCH /api/settings/lists/:key/values/:id  { value?, meaning? } ----------
router.patch("/lists/:key/values/:id", async (req, res, next) => {
  try {
    const def = listDef(req.params.key);
    const doc = await loadDoc(req.params.key);
    const item = findValue(doc, req.params.id);
    const body = req.body || {};
    const before = { value: item.value, meaning: item.meaning };
    const value = "value" in body ? cleanValue(def, body.value) : item.value;
    const meaning = "meaning" in body ? cleanMeaning(def, body.meaning) : item.meaning;

    if (doc.values.some((v) => String(v._id) !== String(item._id) && norm(v.value) === norm(value))) {
      throw new InputError(`"${value}" is already in this list.`, 409);
    }
    checkConsistent(await getLists(), req.params.key, value, meaning);

    let renamed = 0;
    if (value !== before.value) renamed = await renameEverywhere(req.params.key, before.value, value);
    item.value = value;
    item.meaning = meaning;
    await doc.save();
    if (value !== before.value || meaning !== before.meaning) {
      audit(req, "dropdown_updated", { details: { list: req.params.key, op: "edit", before, after: { value, meaning }, renamedIn: renamed } });
    }
    await respond(res);
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- DELETE /api/settings/lists/:key/values/:id ----------
router.delete("/lists/:key/values/:id", async (req, res, next) => {
  try {
    const def = listDef(req.params.key);
    const doc = await loadDoc(req.params.key);
    const item = findValue(doc, req.params.id);
    if (doc.values.length <= MIN_VALUES[def.kind]) {
      throw new InputError(`${def.label} needs at least ${MIN_VALUES[def.kind]} value${MIN_VALUES[def.kind] === 1 ? "" : "s"}.`, 409);
    }
    const n = (await usage(req.params.key)).get(item.value) || 0;
    if (n) {
      const where = def.kind === "plain" ? `${n} Jamaat${n === 1 ? "" : "s"}` : `${n} saved answer${n === 1 ? "" : "s"}`;
      throw new InputError(`"${item.value}" is used by ${where}, so it can't be removed. Rename it instead.`, 409);
    }
    doc.values.pull(item._id);
    await doc.save();
    audit(req, "dropdown_updated", { details: { list: req.params.key, op: "remove", value: item.value } });
    await respond(res);
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PUT /api/settings/lists/:key/order  { ids: [...] } ----------
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
    audit(req, "dropdown_updated", { details: { list: req.params.key, op: "reorder", order: doc.values.map((v) => v.value) } });
    await respond(res);
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
