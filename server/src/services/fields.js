// Portal fields (JC form questions), read from MongoDB and cached in memory.
// A question with "Monthly activities" is answered once per activity of the month; each activity
// behaves like its own question with key "<field key>:<activity id>" (see formFields).
const form = require("../formConfig");
const PortalField = require("../models/PortalField");
const OptionList = require("../models/OptionList");
const Activity = require("../models/Activity");
const Entry = require("../models/Entry");
const { notDeleted, isDeleted } = require("../lib/softDelete");

let cache = null;

/** All fields in display order: [{ id, key, label, section, type, hasComment, hasActivities, required, showOnDashboard, isActive, options:[{id,value,meaning}] }] */
async function getFields() {
  if (cache) return cache;
  // Deleted questions / answers (status "D") are left out everywhere except the Super Admin screen.
  const docs = await PortalField.find(notDeleted()).sort({ order: 1, createdAt: 1 }).lean();
  cache = docs.map((d) => ({
    id: String(d._id),
    key: d.key,
    label: d.label,
    section: d.section || "",
    type: d.type || "select",
    hasComment: d.hasComment === true,
    hasActivities: d.hasActivities === true && (d.type || "select") === "select",
    required: d.required !== false,
    showOnDashboard: d.showOnDashboard !== false,
    isActive: d.isActive !== false,
    options: (d.options || []).filter((o) => !isDeleted(o)).map((o) => ({ id: String(o._id), value: o.value, meaning: o.meaning })),
  }));
  return cache;
}

const invalidate = () => { cache = null; };
const activeFields = async () => (await getFields()).filter((f) => f.isActive);
const toneOf = (meaning) => (form.meanings[meaning] || form.meanings.na).tone;

// ---- activities ----
const SEP = ":"; // "<field key>:<activity id>" (a field key never contains ":")
const activityKey = (fieldKey, activityId) => `${fieldKey}${SEP}${activityId}`;
const baseKey = (k) => String(k).split(SEP)[0];

/** Activities of one month: Map(field key -> [{ id, name }]) in order. includeDeleted for old labels. */
async function activitiesFor(month, { includeDeleted = false } = {}) {
  const docs = await Activity.find({ month, ...(includeDeleted ? {} : notDeleted()) }).sort({ order: 1, createdAt: 1 }).lean();
  const out = new Map();
  for (const a of docs) {
    if (!out.has(a.field)) out.set(a.field, []);
    out.get(a.field).push({ id: String(a._id), name: a.name, deleted: isDeleted(a) });
  }
  return out;
}

/**
 * The questions of one month, with each activity question split into one question per activity:
 *   { ...field, key: "tibb:<id>", label: "Tibb: <activity>", parentKey, parentLabel, activity: { id, name }, required: false }
 * An activity question with no activities that month has nothing to answer, so it is left out.
 * { all: true } = also inactive questions and deleted activities (labels for saved data).
 */
async function formFields(month, { all = false } = {}) {
  const [fields, acts] = await Promise.all([all ? getFields() : activeFields(), activitiesFor(month, { includeDeleted: all })]);
  const out = [];
  for (const f of fields) {
    if (!f.hasActivities) { out.push(f); continue; }
    for (const a of acts.get(f.key) || []) {
      out.push({
        ...f, key: activityKey(f.key, a.id), label: `${f.label}: ${a.name}`, required: false,
        parentKey: f.key, parentLabel: f.label, activity: { id: a.id, name: a.name },
      });
    }
  }
  return out;
}

/** What the JC portal needs for one question. */
const portalShape = (f) => ({
  key: f.key,
  label: f.label,
  group: f.section,
  type: f.type,
  hasComment: f.hasComment,
  hasActivities: !!f.hasActivities && !f.parentKey,
  required: f.required,
  options: f.options.map((o) => ({ value: o.value, tone: toneOf(o.meaning) })),
  ...(f.parentKey ? { parentKey: f.parentKey, parentLabel: f.parentLabel, activity: f.activity } : {}),
});

/** Dashboard cards for a month: active dropdown fields marked "show on dashboard" (one card per activity). */
async function dashboardMetrics(month) {
  return (await formFields(month))
    .filter((f) => f.showOnDashboard && f.type === "select")
    .map((f) => {
      const pending = f.options.find((o) => o.meaning === "pending");
      return {
        ...portalShape(f),
        done: f.options.filter((o) => o.meaning === "done").map((o) => o.value),
        defaultStatus: (pending || f.options[0] || {}).value || "",
      };
    });
}

/** How many saved answers use each answer: Map(fieldKey -> Map(value -> count)) (activities count for their question). */
async function answerUsage() {
  const rows = await Entry.aggregate([
    { $project: { v: { $objectToArray: { $ifNull: ["$values", {}] } } } },
    { $unwind: "$v" },
    { $group: { _id: { k: "$v.k", v: "$v.v" }, n: { $sum: 1 } } },
  ]);
  const out = new Map();
  for (const r of rows) {
    const k = baseKey(r._id.k);
    if (!out.has(k)) out.set(k, new Map());
    const m = out.get(k);
    m.set(r._id.v, (m.get(r._id.v) || 0) + r.n);
  }
  return out;
}

/** Every key a question's answers are saved under: its own key plus one per activity (any month, deleted too). */
async function savedKeysOf(field) {
  const acts = await Activity.find({ field: field.key }).select("_id").lean();
  return [field.key, ...acts.map((a) => activityKey(field.key, String(a._id)))];
}

/** Creates the starting questions the first time (keeps answer lists edited earlier, if any). */
async function seedFields() {
  if (await PortalField.estimatedDocumentCount()) return;
  const old = Object.fromEntries((await OptionList.find({ key: { $in: ["progress", "yesNo"] } }).lean()).map((d) => [d.key, d.values]));
  const isYesNo = (opts) => opts.some(([v]) => v === "Yes");
  await PortalField.insertMany(
    form.defaultFields.map((f, i) => {
      const base = { key: f.key, label: f.label, section: f.section, order: i, required: f.required !== false, showOnDashboard: f.showOnDashboard !== false, hasActivities: f.hasActivities === true };
      if (f.type === "date") return { ...base, type: "date", showOnDashboard: false, hasActivities: false, options: [] };
      const earlier = old[isYesNo(f.options) ? "yesNo" : "progress"];
      const options = earlier && earlier.length && earlier.every((v) => v.meaning) && f.options.length > 2
        ? earlier.map((v) => ({ value: v.value, meaning: v.meaning }))
        : f.options.map(([value, meaning]) => ({ value, meaning }));
      return { ...base, options };
    })
  );
  console.log(`[fields] Created ${form.defaultFields.length} starting portal fields`);
  invalidate();
}

module.exports = {
  getFields, activeFields, invalidate, toneOf, portalShape, dashboardMetrics, answerUsage, seedFields,
  activitiesFor, formFields, activityKey, baseKey, savedKeysOf,
};
