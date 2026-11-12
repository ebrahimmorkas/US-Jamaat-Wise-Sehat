// Portal fields (JC form questions), read from MongoDB and cached in memory.
const form = require("../formConfig");
const PortalField = require("../models/PortalField");
const OptionList = require("../models/OptionList");
const Entry = require("../models/Entry");
const { notDeleted, isDeleted } = require("../lib/softDelete");

let cache = null;

/** All fields in display order: [{ id, key, label, section, type, hasComment, required, showOnDashboard, isActive, options:[{id,value,meaning}] }] */
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

/** What the JC portal needs for one question. */
const portalShape = (f) => ({
  key: f.key,
  label: f.label,
  group: f.section,
  type: f.type,
  hasComment: f.hasComment,
  required: f.required,
  options: f.options.map((o) => ({ value: o.value, tone: toneOf(o.meaning) })),
});

/** Dashboard cards: active dropdown fields marked "show on dashboard". */
async function dashboardMetrics() {
  return (await activeFields())
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

/** How many saved entries use each answer: Map(fieldKey -> Map(value -> count)). */
async function answerUsage() {
  const rows = await Entry.aggregate([
    { $project: { v: { $objectToArray: { $ifNull: ["$values", {}] } } } },
    { $unwind: "$v" },
    { $group: { _id: { k: "$v.k", v: "$v.v" }, n: { $sum: 1 } } },
  ]);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r._id.k)) out.set(r._id.k, new Map());
    out.get(r._id.k).set(r._id.v, r.n);
  }
  return out;
}

/** Creates the starting questions the first time (keeps answer lists edited earlier, if any). */
async function seedFields() {
  if (await PortalField.estimatedDocumentCount()) return;
  const old = Object.fromEntries((await OptionList.find({ key: { $in: ["progress", "yesNo"] } }).lean()).map((d) => [d.key, d.values]));
  const isYesNo = (opts) => opts.some(([v]) => v === "Yes");
  await PortalField.insertMany(
    form.defaultFields.map((f, i) => {
      const base = { key: f.key, label: f.label, section: f.section, order: i, required: f.required !== false, showOnDashboard: f.showOnDashboard !== false };
      if (f.type === "date") return { ...base, type: "date", showOnDashboard: false, options: [] };
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

module.exports = { getFields, activeFields, invalidate, toneOf, portalShape, dashboardMetrics, answerUsage, seedFields };
