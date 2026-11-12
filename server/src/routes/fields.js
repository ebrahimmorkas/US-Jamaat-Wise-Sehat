// Portal fields = the dropdown questions on the JC portal (Super Admin only).
// Each field has its own answers. Rules that keep saved data correct:
//  - A field's storage key never changes, so renaming a question keeps its saved answers.
//  - Renaming an answer renames it in every saved entry of that field.
//  - An answer in use can't be removed; a field with saved answers can't be deleted (mark it inactive).
//  - Question names are unique; answers are unique inside a question (ignoring capitals/spaces).
const crypto = require("crypto");
const express = require("express");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const PortalField = require("../models/PortalField");
const { MEANINGS, TYPES } = require("../models/PortalField");
const Entry = require("../models/Entry");
const { audit, diff } = require("../services/audit");
const { answerUsage, invalidate } = require("../services/fields");
const { InputError, isId, sendError } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

// Audit trail labels.
const TYPE_LABELS = { select: "Dropdown", date: "Date" };
const FIELD_SPEC = [["label", "Question"], ["section", "Section"], ["type", "Type", (t) => (t ? TYPE_LABELS[t] || t : t)], ["hasComment", "Comment box"], ["required", "Required"], ["showOnDashboard", "Show on dashboard"], ["isActive", "Active"]];
const meaningLabel = (m) => (form.meanings[m] || {}).label || m;
const answerText = (o) => `${o.value} (${meaningLabel(o.meaning)})`;
const fieldTarget = (f) => ({ type: "field", id: String(f._id), label: f.label });

const RESERVED = ["not filled", "other", "all"]; // words the dashboard uses itself
const MIN_OPTIONS = 2;
const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();
const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

function cleanLabel(v) {
  const s = clean(v);
  if (s.length < 2) throw new InputError("Enter the question (at least 2 characters).");
  if (s.length > 80) throw new InputError("Keep the question under 80 characters.");
  return s;
}
function cleanSection(v) {
  const s = clean(v);
  if (s.length > 60) throw new InputError("Keep the section name under 60 characters.");
  return s;
}
function cleanBool(v, name) {
  if (typeof v !== "boolean") throw new InputError(`${name} must be true or false.`);
  return v;
}
function cleanOption(v) {
  const s = clean(v);
  if (!s) throw new InputError("Enter the answer.");
  if (s.length > 40) throw new InputError("Keep the answer under 40 characters.");
  if (RESERVED.includes(s.toLowerCase())) throw new InputError(`"${s}" is used by the dashboard itself. Choose another word.`);
  return s;
}
function cleanMeaning(m) {
  if (!MEANINGS.includes(m)) throw new InputError("Choose what this answer means.");
  return m;
}

async function uniqueLabel(label, exceptId) {
  const all = await PortalField.find(exceptId ? { _id: { $ne: exceptId } } : {}).select("label").lean();
  if (all.some((f) => norm(f.label) === norm(label))) throw new InputError(`A question called "${label}" already exists.`, 409);
}

async function loadField(id) {
  const f = isId(id) ? await PortalField.findById(id) : null;
  if (!f) throw new InputError("Question not found. Reload the page.", 404);
  return f;
}
// Answers belong to dropdown questions only.
async function loadDropdown(id) {
  const f = await loadField(id);
  if ((f.type || "select") !== "select") throw new InputError("A date question has no answers.", 409);
  return f;
}
function findOption(field, id) {
  const o = isId(id) ? field.options.id(id) : null;
  if (!o) throw new InputError("Answer not found. Reload the page.", 404);
  return o;
}

async function payload() {
  invalidate();
  const [fields, usage] = await Promise.all([PortalField.find().sort({ order: 1, createdAt: 1 }).lean(), answerUsage()]);
  return {
    meanings: Object.entries(form.meanings).map(([key, m]) => ({ key, label: m.label, tone: m.tone })),
    fields: fields.map((f) => {
      const used = usage.get(f.key) || new Map();
      return {
        id: String(f._id),
        key: f.key,
        label: f.label,
        section: f.section || "",
        type: f.type || "select",
        hasComment: f.hasComment === true,
        required: f.required !== false,
        showOnDashboard: f.showOnDashboard !== false,
        isActive: f.isActive !== false,
        answered: [...used.values()].reduce((a, b) => a + b, 0),
        options: f.options.map((o) => ({ id: String(o._id), value: o.value, meaning: o.meaning, inUse: used.get(o.value) || 0 })),
      };
    }),
  };
}

// ---------- GET /api/fields ----------
router.get("/", async (req, res, next) => {
  try {
    res.json(await payload());
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/fields  { label, section, type, hasComment, required, showOnDashboard, options:[{value, meaning}] } ----------
router.post("/", async (req, res, next) => {
  try {
    const b = req.body || {};
    const label = cleanLabel(b.label);
    await uniqueLabel(label);
    const type = b.type === undefined ? "select" : b.type;
    if (!TYPES.includes(type)) throw new InputError("Choose the type of question.");
    const isDate = type === "date";
    const options = isDate ? [] : (Array.isArray(b.options) ? b.options : []).map((o) => ({ value: cleanOption(o && o.value), meaning: cleanMeaning(o && o.meaning) }));
    if (!isDate && options.length < MIN_OPTIONS) throw new InputError(`Add at least ${MIN_OPTIONS} answers.`);
    const seen = new Set();
    for (const o of options) {
      if (seen.has(norm(o.value))) throw new InputError(`The answer "${o.value}" is listed twice.`);
      seen.add(norm(o.value));
    }
    const last = await PortalField.findOne().sort({ order: -1 }).select("order").lean();
    const f = await PortalField.create({
      key: "f" + crypto.randomBytes(6).toString("hex"),
      label,
      section: cleanSection(b.section),
      type,
      hasComment: "hasComment" in b ? cleanBool(b.hasComment, "Comment box") : true, // ticked by default
      required: "required" in b ? cleanBool(b.required, "Required") : true,
      // the dashboard cards count dropdown answers, so a date question isn't shown there
      showOnDashboard: isDate ? false : "showOnDashboard" in b ? cleanBool(b.showOnDashboard, "Show on dashboard") : true,
      order: last ? last.order + 1 : 0,
      options,
    });
    audit(req, "field_created", { target: fieldTarget(f), changes: [...diff(null, f, FIELD_SPEC), ...(isDate ? [] : [{ field: "options", label: "Answers", from: null, to: options.map(answerText) }])] });
    res.status(201).json({ ...(await payload()), createdId: String(f._id) });
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PATCH /api/fields/:id  { label?, section?, hasComment?, required?, showOnDashboard?, isActive? } ----------
// (the type is chosen once, when the question is created)
router.patch("/:id", async (req, res, next) => {
  try {
    const b = req.body || {};
    const f = await loadField(req.params.id);
    const before = { label: f.label, section: f.section, hasComment: f.hasComment, required: f.required, showOnDashboard: f.showOnDashboard, isActive: f.isActive };
    if ("label" in b) {
      const label = cleanLabel(b.label);
      if (norm(label) !== norm(f.label)) await uniqueLabel(label, f._id);
      f.label = label;
    }
    if ("section" in b) f.section = cleanSection(b.section);
    if ("required" in b) f.required = cleanBool(b.required, "Required");
    if ("hasComment" in b) f.hasComment = cleanBool(b.hasComment, "Comment box");
    if ("showOnDashboard" in b) {
      f.showOnDashboard = cleanBool(b.showOnDashboard, "Show on dashboard");
      if (f.showOnDashboard && f.type === "date") throw new InputError("A date question can't have a dashboard card.");
    }
    if ("isActive" in b) f.isActive = cleanBool(b.isActive, "Active");
    await f.save();
    const changes = diff(before, f, FIELD_SPEC);
    if (changes.length) audit(req, "field_updated", { target: fieldTarget(f), changes });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- DELETE /api/fields/:id ----------
router.delete("/:id", async (req, res, next) => {
  try {
    const f = await loadField(req.params.id);
    const n = await Entry.countDocuments({ $or: [{ [`values.${f.key}`]: { $exists: true } }, { [`comments.${f.key}`]: { $exists: true } }] });
    if (n) throw new InputError(`"${f.label}" is answered in ${n} saved form${n === 1 ? "" : "s"}, so it can't be deleted. Mark it inactive instead.`, 409);
    await f.deleteOne();
    audit(req, "field_deleted", { target: fieldTarget(f), changes: [...diff(f, null, FIELD_SPEC), { field: "options", label: "Answers", from: f.options.map(answerText), to: null }] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PUT /api/fields/order  { ids } ----------
router.put("/order", async (req, res, next) => {
  try {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : [];
    const all = (await PortalField.find().select("_id").lean()).map((f) => String(f._id));
    if (ids.length !== all.length || new Set(ids).size !== ids.length || !ids.every((id) => all.includes(id))) {
      throw new InputError("The questions changed meanwhile. Reload the page.", 409);
    }
    const beforeOrder = (await PortalField.find().sort({ order: 1, createdAt: 1 }).select("label").lean()).map((x) => x.label);
    await PortalField.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i } } } })));
    const afterOrder = (await PortalField.find().sort({ order: 1, createdAt: 1 }).select("label").lean()).map((x) => x.label);
    audit(req, "field_updated", { target: { type: "fields", id: "order", label: "Question order" }, changes: [{ field: "order", label: "Question order", from: beforeOrder, to: afterOrder }] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- answers of one field ----------
router.post("/:id/options", async (req, res, next) => {
  try {
    const f = await loadDropdown(req.params.id);
    const value = cleanOption((req.body || {}).value);
    const meaning = cleanMeaning((req.body || {}).meaning);
    if (f.options.some((o) => norm(o.value) === norm(value))) throw new InputError(`"${value}" is already an answer of this question.`, 409);
    f.options.push({ value, meaning });
    await f.save();
    audit(req, "field_updated", { target: fieldTarget(f), changes: [{ field: "options", label: "Answer added", from: null, to: answerText({ value, meaning }) }] });
    res.status(201).json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

router.patch("/:id/options/:oid", async (req, res, next) => {
  try {
    const f = await loadDropdown(req.params.id);
    const o = findOption(f, req.params.oid);
    const b = req.body || {};
    const before = { value: o.value, meaning: o.meaning };
    const value = "value" in b ? cleanOption(b.value) : o.value;
    const meaning = "meaning" in b ? cleanMeaning(b.meaning) : o.meaning;
    if (f.options.some((x) => String(x._id) !== String(o._id) && norm(x.value) === norm(value))) {
      throw new InputError(`"${value}" is already an answer of this question.`, 409);
    }
    let renamed = 0;
    if (value !== before.value) {
      renamed = (await Entry.updateMany({ [`values.${f.key}`]: before.value }, { $set: { [`values.${f.key}`]: value } })).modifiedCount;
    }
    o.value = value;
    o.meaning = meaning;
    await f.save();
    if (value !== before.value || meaning !== before.meaning) {
      audit(req, "field_updated", {
        target: fieldTarget(f),
        changes: diff(before, { value, meaning }, [["value", "Answer"], ["meaning", `Meaning of "${value}"`, meaningLabel]]),
        details: renamed ? { savedFormsRenamed: renamed } : undefined,
      });
    }
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

router.delete("/:id/options/:oid", async (req, res, next) => {
  try {
    const f = await loadDropdown(req.params.id);
    const o = findOption(f, req.params.oid);
    if (f.options.length <= MIN_OPTIONS) throw new InputError(`A question needs at least ${MIN_OPTIONS} answers.`, 409);
    const n = await Entry.countDocuments({ [`values.${f.key}`]: o.value });
    if (n) throw new InputError(`"${o.value}" is used in ${n} saved form${n === 1 ? "" : "s"}, so it can't be removed. Rename it instead.`, 409);
    f.options.pull(o._id);
    await f.save();
    audit(req, "field_updated", { target: fieldTarget(f), changes: [{ field: "options", label: "Answer removed", from: answerText(o), to: null }] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

router.put("/:id/options/order", async (req, res, next) => {
  try {
    const f = await loadDropdown(req.params.id);
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : [];
    const current = f.options.map((o) => String(o._id));
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw new InputError("The answers changed meanwhile. Reload the page.", 409);
    }
    const byId = new Map(f.options.map((o) => [String(o._id), o.toObject()]));
    const beforeOrder = f.options.map((o) => o.value);
    f.options = ids.map((id) => byId.get(id));
    await f.save();
    audit(req, "field_updated", { target: fieldTarget(f), changes: [{ field: "options.order", label: "Answer order", from: beforeOrder, to: f.options.map((o) => o.value) }] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
