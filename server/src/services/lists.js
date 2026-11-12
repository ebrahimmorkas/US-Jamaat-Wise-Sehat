// Simple dropdown lists (Mauze Type), read from MongoDB and cached in memory.
const form = require("../formConfig");
const OptionList = require("../models/OptionList");
const { isDeleted } = require("../lib/softDelete");

let cache = null;

/** { mauzeType: [{ id, value }] }  (deleted values, status "D", are left out) */
async function getLists() {
  if (cache) return cache;
  const docs = await OptionList.find({ key: { $in: Object.keys(form.lists) } }).lean();
  const out = {};
  for (const key of Object.keys(form.lists)) {
    const doc = docs.find((d) => d.key === key);
    out[key] = doc ? doc.values.filter((v) => !isDeleted(v)).map((v) => ({ id: String(v._id), value: v.value })) : [];
  }
  cache = out;
  return out;
}

const invalidate = () => { cache = null; };

/** Values only: { mauzeType: ["UMMAL", ...] } */
async function getValueSets() {
  const lists = await getLists();
  return Object.fromEntries(Object.entries(lists).map(([k, vals]) => [k, vals.map((v) => v.value)]));
}

/** Creates the lists from formConfig defaults the first time. */
async function seedLists() {
  for (const [key, def] of Object.entries(form.lists)) {
    if (await OptionList.exists({ key })) continue;
    await OptionList.create({ key, values: def.defaults.map((value) => ({ value })) });
    console.log(`[lists] Created dropdown list "${key}" with default values`);
  }
  invalidate();
}

module.exports = { getLists, getValueSets, seedLists, invalidate };
