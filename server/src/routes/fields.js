// Portal fields = the dropdown questions on the JC portal (Super Admin only).
// Each field has its own answers. Rules that keep saved data correct:
//  - A field's storage key never changes, so renaming a question keeps its saved answers.
//  - Renaming an answer renames it in every saved entry of that field.
//  - An answer in use can't be removed; a field with saved answers can't be deleted (mark it inactive).
//  - Deleting a question or an answer only sets status "D" (hidden, kept, restorable).
//  - Question names are unique; answers are unique inside a question (ignoring capitals/spaces).
//  - A question with "Monthly activities" has a list of activities per Hijri month; each activity is
//    answered on its own (entries.values["<key>:<activity id>"]). Activities follow the same rules.
const crypto = require("crypto");
const express = require("express");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const PortalField = require("../models/PortalField");
const { MEANINGS, TYPES } = require("../models/PortalField");
const Entry = require("../models/Entry");
const Activity = require("../models/Activity");
const { audit, diff } = require("../services/audit");
const { answerUsage, invalidate, activityKey, savedKeysOf } = require("../services/fields");
const { isMonth, currentMonth, addMonths, monthInfo, monthLabel, portalMonths } = require("../lib/month");
const { InputError, isId, sendError } = require("../lib/validate");
const { DELETED, notDeleted, isDeleted, markDeleted, markRestored, deletedInfo, statusChange } = require("../lib/softDelete");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

// Audit trail labels.
const TYPE_LABELS = { select: "Dropdown", date: "Date" };
const FIELD_SPEC = [["label", "Question"], ["section", "Section"], ["type", "Type", (t) => (t ? TYPE_LABELS[t] || t : t)], ["hasComment", "Comment box"], ["hasActivities", "Monthly activities"], ["required", "Required"], ["showOnDashboard", "Show on dashboard"], ["isActive", "Active"]];
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

// Question names are unique, deleted questions included (restore one instead of adding it again).
async function uniqueLabel(label, exceptId) {
  const all = await PortalField.find(exceptId ? { _id: { $ne: exceptId } } : {}).select("label status").lean();
  const hit = all.find((f) => norm(f.label) === norm(label));
  if (!hit) return;
  throw new InputError(isDeleted(hit)
    ? `A deleted question called "${hit.label}" exists. Click “Show deleted” and restore it instead.`
    : `A question called "${label}" already exists.`, 409);
}

// A question that isn't deleted (deleted ones can only be restored).
async function loadField(id, { allowDeleted = false } = {}) {
  const f = isId(id) ? await PortalField.findById(id) : null;
  if (!f) throw new InputError("Question not found. Reload the page.", 404);
  if (!allowDeleted && isDeleted(f)) throw new InputError(`"${f.label}" is deleted. Restore it first to change it.`, 409);
  return f;
}
// Answers belong to dropdown questions only.
async function loadDropdown(id) {
  const f = await loadField(id);
  if ((f.type || "select") !== "select") throw new InputError("A date question has no answers.", 409);
  return f;
}
function findOption(field, id, { allowDeleted = false } = {}) {
  const o = isId(id) ? field.options.id(id) : null;
  if (!o) throw new InputError("Answer not found. Reload the page.", 404);
  if (!allowDeleted && isDeleted(o)) throw new InputError(`"${o.value}" is deleted. Restore it first to change it.`, 409);
  return o;
}
const liveOptions = (f) => f.options.filter((o) => !isDeleted(o));
// Answers are unique inside a question, removed ones included (restore one instead of adding it again).
function checkAnswerFree(f, value, exceptId) {
  const hit = f.options.find((x) => String(x._id) !== String(exceptId || "") && norm(x.value) === norm(value));
  if (!hit) return;
  throw new InputError(isDeleted(hit)
    ? `"${hit.value}" was deleted from this question earlier. Click “Show deleted” and restore it instead.`
    : `"${value}" is already an answer of this question.`, 409);
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
        hasActivities: f.hasActivities === true,
        required: f.required !== false,
        showOnDashboard: f.showOnDashboard !== false,
        isActive: f.isActive !== false,
        ...deletedInfo(f),
        answered: [...used.values()].reduce((a, b) => a + b, 0),
        options: f.options.map((o) => ({ id: String(o._id), value: o.value, meaning: o.meaning, inUse: used.get(o.value) || 0, ...deletedInfo(o) })),
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
      hasActivities: isDate ? false : "hasActivities" in b ? cleanBool(b.hasActivities, "Monthly activities") : false,
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
    const before = { label: f.label, section: f.section, hasComment: f.hasComment, hasActivities: f.hasActivities, required: f.required, showOnDashboard: f.showOnDashboard, isActive: f.isActive };
    if ("label" in b) {
      const label = cleanLabel(b.label);
      if (norm(label) !== norm(f.label)) await uniqueLabel(label, f._id);
      f.label = label;
    }
    if ("section" in b) f.section = cleanSection(b.section);
    if ("required" in b) f.required = cleanBool(b.required, "Required");
    if ("hasComment" in b) f.hasComment = cleanBool(b.hasComment, "Comment box");
    if ("hasActivities" in b) {
      f.hasActivities = cleanBool(b.hasActivities, "Monthly activities");
      if (f.hasActivities && f.type === "date") throw new InputError("A date question can't have monthly activities.");
    }
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
    const keys = await savedKeysOf(f);
    const n = await Entry.countDocuments({ $or: keys.flatMap((k) => [{ [`values.${k}`]: { $exists: true } }, { [`comments.${k}`]: { $exists: true } }]) });
    if (n) throw new InputError(`"${f.label}" is answered in ${n} saved form${n === 1 ? "" : "s"}, so it can't be deleted. Mark it inactive instead.`, 409);
    const before = { isActive: f.isActive };
    markDeleted(f, req.user.email); // status "D": hidden from the portal and the dashboard, kept
    await f.save();
    audit(req, "field_deleted", { target: fieldTarget(f), changes: [statusChange("A", DELETED), ...diff(before, f, [["isActive", "Active"]])] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/fields/:id/restore ----------
router.post("/:id/restore", async (req, res, next) => {
  try {
    const f = await loadField(req.params.id, { allowDeleted: true });
    if (!isDeleted(f)) throw new InputError(`"${f.label}" is not deleted.`, 409);
    await uniqueLabel(f.label, f._id);
    const before = { isActive: f.isActive };
    markRestored(f);
    await f.save();
    audit(req, "field_restored", { target: fieldTarget(f), changes: [statusChange(DELETED, "A"), ...diff(before, f, [["isActive", "Active"]])] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PUT /api/fields/order  { ids } ----------  (questions that aren't deleted)
router.put("/order", async (req, res, next) => {
  try {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : [];
    const all = (await PortalField.find(notDeleted()).select("_id").lean()).map((f) => String(f._id));
    if (ids.length !== all.length || new Set(ids).size !== ids.length || !ids.every((id) => all.includes(id))) {
      throw new InputError("The questions changed meanwhile. Reload the page.", 409);
    }
    const beforeOrder = (await PortalField.find(notDeleted()).sort({ order: 1, createdAt: 1 }).select("label").lean()).map((x) => x.label);
    await PortalField.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i } } } })));
    const afterOrder = (await PortalField.find(notDeleted()).sort({ order: 1, createdAt: 1 }).select("label").lean()).map((x) => x.label);
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
    checkAnswerFree(f, value);
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
    checkAnswerFree(f, value, o._id);
    let renamed = 0;
    if (value !== before.value) {
      for (const k of await savedKeysOf(f)) {
        renamed += (await Entry.updateMany({ [`values.${k}`]: before.value }, { $set: { [`values.${k}`]: value } })).modifiedCount;
      }
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
    if (liveOptions(f).length <= MIN_OPTIONS) throw new InputError(`A question needs at least ${MIN_OPTIONS} answers.`, 409);
    const n = await Entry.countDocuments({ $or: (await savedKeysOf(f)).map((k) => ({ [`values.${k}`]: o.value })) });
    if (n) throw new InputError(`"${o.value}" is used in ${n} saved form${n === 1 ? "" : "s"}, so it can't be removed. Rename it instead.`, 409);
    markDeleted(o, req.user.email); // status "D": hidden from the portal, kept
    await f.save();
    audit(req, "field_updated", { target: fieldTarget(f), changes: [{ field: "options", label: "Answer deleted (status D)", from: answerText(o), to: null }] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

router.post("/:id/options/:oid/restore", async (req, res, next) => {
  try {
    const f = await loadDropdown(req.params.id);
    const o = findOption(f, req.params.oid, { allowDeleted: true });
    if (!isDeleted(o)) throw new InputError(`"${o.value}" is not deleted.`, 409);
    checkAnswerFree(f, o.value, o._id);
    markRestored(o);
    await f.save();
    audit(req, "field_updated", { target: fieldTarget(f), changes: [{ field: "options", label: "Answer restored", from: null, to: answerText(o) }] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// Order of the answers that aren't deleted (deleted ones stay at the end).
router.put("/:id/options/order", async (req, res, next) => {
  try {
    const f = await loadDropdown(req.params.id);
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : [];
    const current = liveOptions(f).map((o) => String(o._id));
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw new InputError("The answers changed meanwhile. Reload the page.", 409);
    }
    const byId = new Map(f.options.map((o) => [String(o._id), o.toObject()]));
    const beforeOrder = liveOptions(f).map((o) => o.value);
    f.options = [...ids.map((id) => byId.get(id)), ...f.options.filter((o) => isDeleted(o)).map((o) => o.toObject())];
    await f.save();
    audit(req, "field_updated", { target: fieldTarget(f), changes: [{ field: "options.order", label: "Answer order", from: beforeOrder, to: liveOptions(f).map((o) => o.value) }] });
    res.json(await payload());
  } catch (err) {
    sendError(err, res, next);
  }
});

// ================= monthly activities of one question =================
// Months the Super Admin can plan: the JC portal's months plus next month (to prepare it in advance).
const activityMonths = () => [addMonths(currentMonth(), 1), ...portalMonths()];
function cleanMonth(v) {
  if (!isMonth(v) || !activityMonths().includes(v)) throw new InputError("Choose a valid month.");
  return v;
}
function cleanActivity(v) {
  const s = clean(v);
  if (s.length < 2) throw new InputError("Enter the activity (at least 2 characters).");
  if (s.length > 80) throw new InputError("Keep the activity under 80 characters.");
  return s;
}
async function loadActivityField(id) {
  const f = await loadField(id);
  if (!f.hasActivities) throw new InputError(`"${f.label}" doesn't have monthly activities. Switch them on first.`, 409);
  return f;
}
async function loadActivity(f, aid, { allowDeleted = false } = {}) {
  const a = isId(aid) ? await Activity.findOne({ _id: aid, field: f.key }) : null;
  if (!a) throw new InputError("Activity not found. Reload the page.", 404);
  if (!allowDeleted && isDeleted(a)) throw new InputError(`"${a.name}" is deleted. Restore it first to change it.`, 409);
  return a;
}
// Activity names are unique inside a question + month, deleted ones included.
async function checkActivityFree(f, month, name, exceptId) {
  const all = await Activity.find({ field: f.key, month, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).select("name status").lean();
  const hit = all.find((a) => norm(a.name) === norm(name));
  if (!hit) return;
  throw new InputError(isDeleted(hit)
    ? `"${hit.name}" was deleted from this month earlier. Click “Show deleted” and restore it instead.`
    : `"${name}" is already an activity of this month.`, 409);
}
const activityTarget = (f, a) => ({ type: "activity", id: String(a._id), label: `${f.label} · ${monthLabel(a.month)} · ${a.name}` });

async function activityPayload(f, month) {
  const acts = await Activity.find({ field: f.key, month }).sort({ order: 1, createdAt: 1 }).lean();
  const counts = await Promise.all(acts.map((a) => Entry.countDocuments({ month, [`values.${activityKey(f.key, String(a._id))}`]: { $exists: true } })));
  const prev = addMonths(month, -1);
  return {
    month,
    months: activityMonths().map(monthInfo),
    activities: acts.map((a, i) => ({ id: String(a._id), name: a.name, inUse: counts[i], ...deletedInfo(a) })),
    previous: { ...monthInfo(prev), count: await Activity.countDocuments({ field: f.key, month: prev, ...notDeleted() }) },
  };
}

// ---------- GET /api/fields/:id/activities?month=YYYY-MM ----------
router.get("/:id/activities", async (req, res, next) => {
  try {
    const f = await loadActivityField(req.params.id);
    res.json(await activityPayload(f, req.query.month ? cleanMonth(req.query.month) : currentMonth()));
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/fields/:id/activities  { month, name } ----------
router.post("/:id/activities", async (req, res, next) => {
  try {
    const f = await loadActivityField(req.params.id);
    const b = req.body || {};
    const month = cleanMonth(b.month);
    const name = cleanActivity(b.name);
    await checkActivityFree(f, month, name);
    const last = await Activity.findOne({ field: f.key, month }).sort({ order: -1 }).select("order").lean();
    const a = await Activity.create({ field: f.key, month, name, order: last ? last.order + 1 : 0 });
    audit(req, "field_updated", { target: activityTarget(f, a), changes: [{ field: "activities", label: `Activity added (${monthLabel(month)})`, from: null, to: name }] });
    res.status(201).json(await activityPayload(f, month));
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/fields/:id/activities/copy  { month } ----------  copy last month's list
router.post("/:id/activities/copy", async (req, res, next) => {
  try {
    const f = await loadActivityField(req.params.id);
    const month = cleanMonth((req.body || {}).month);
    const prev = addMonths(month, -1);
    const from = await Activity.find({ field: f.key, month: prev, ...notDeleted() }).sort({ order: 1, createdAt: 1 }).lean();
    if (!from.length) throw new InputError(`${monthLabel(prev)} has no activities to copy.`, 409);
    const here = await Activity.find({ field: f.key, month }).select("name order").lean();
    const taken = new Set(here.map((a) => norm(a.name)));
    let order = here.reduce((m, a) => Math.max(m, a.order), -1) + 1;
    const add = from.filter((a) => !taken.has(norm(a.name))).map((a) => ({ field: f.key, month, name: a.name, order: order++ }));
    if (!add.length) throw new InputError(`All activities of ${monthLabel(prev)} are already in ${monthLabel(month)}.`, 409);
    await Activity.insertMany(add);
    audit(req, "field_updated", {
      target: { type: "activity", id: `${f.key}:${month}`, label: `${f.label} · ${monthLabel(month)}` },
      changes: [{ field: "activities", label: `Activities copied from ${monthLabel(prev)}`, from: null, to: add.map((a) => a.name) }],
    });
    res.status(201).json(await activityPayload(f, month));
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PUT /api/fields/:id/activities/order  { month, ids } ----------
router.put("/:id/activities/order", async (req, res, next) => {
  try {
    const f = await loadActivityField(req.params.id);
    const month = cleanMonth((req.body || {}).month);
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    const live = await Activity.find({ field: f.key, month, ...notDeleted() }).sort({ order: 1, createdAt: 1 }).select("name").lean();
    const current = live.map((a) => String(a._id));
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      throw new InputError("The activities changed meanwhile. Reload the page.", 409);
    }
    await Activity.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: i } } } })));
    const name = new Map(live.map((a) => [String(a._id), a.name]));
    audit(req, "field_updated", {
      target: { type: "activity", id: `${f.key}:${month}`, label: `${f.label} · ${monthLabel(month)}` },
      changes: [{ field: "activities.order", label: "Activity order", from: live.map((a) => a.name), to: ids.map((id) => name.get(id)) }],
    });
    res.json(await activityPayload(f, month));
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- PATCH /api/fields/:id/activities/:aid  { name } ----------  (saved answers keep working)
router.patch("/:id/activities/:aid", async (req, res, next) => {
  try {
    const f = await loadActivityField(req.params.id);
    const a = await loadActivity(f, req.params.aid);
    const name = cleanActivity((req.body || {}).name);
    if (norm(name) !== norm(a.name)) await checkActivityFree(f, a.month, name, a._id);
    const before = a.name;
    a.name = name;
    await a.save();
    if (before !== name) audit(req, "field_updated", { target: activityTarget(f, a), changes: [{ field: "activities.name", label: `Activity (${monthLabel(a.month)})`, from: before, to: name }] });
    res.json(await activityPayload(f, a.month));
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- DELETE /api/fields/:id/activities/:aid ----------  status D; not when already answered
router.delete("/:id/activities/:aid", async (req, res, next) => {
  try {
    const f = await loadActivityField(req.params.id);
    const a = await loadActivity(f, req.params.aid);
    const k = activityKey(f.key, String(a._id));
    const n = await Entry.countDocuments({ $or: [{ [`values.${k}`]: { $exists: true } }, { [`comments.${k}`]: { $exists: true } }] });
    if (n) throw new InputError(`"${a.name}" is answered in ${n} saved form${n === 1 ? "" : "s"}, so it can't be deleted. Rename it instead.`, 409);
    markDeleted(a, req.user.email);
    await a.save();
    audit(req, "field_updated", { target: activityTarget(f, a), changes: [{ field: "activities", label: `Activity deleted (status D, ${monthLabel(a.month)})`, from: a.name, to: null }] });
    res.json(await activityPayload(f, a.month));
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/fields/:id/activities/:aid/restore ----------
router.post("/:id/activities/:aid/restore", async (req, res, next) => {
  try {
    const f = await loadActivityField(req.params.id);
    const a = await loadActivity(f, req.params.aid, { allowDeleted: true });
    if (!isDeleted(a)) throw new InputError(`"${a.name}" is not deleted.`, 409);
    await checkActivityFree(f, a.month, a.name, a._id);
    markRestored(a);
    await a.save();
    audit(req, "field_updated", { target: activityTarget(f, a), changes: [{ field: "activities", label: `Activity restored (${monthLabel(a.month)})`, from: null, to: a.name }] });
    res.json(await activityPayload(f, a.month));
  } catch (err) {
    sendError(err, res, next);
  }
});

module.exports = router;
