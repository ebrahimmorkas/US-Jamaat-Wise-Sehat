// Dropdown lists (answer choices + Mauze Type), read from MongoDB and cached in memory.
const form = require("../formConfig");
const OptionList = require("../models/OptionList");

let cache = null;

/** { progress: [{ id, value, meaning }], yesNo: [...], mauzeType: [...] } */
async function getLists() {
  if (cache) return cache;
  const docs = await OptionList.find().lean();
  const out = {};
  for (const key of Object.keys(form.lists)) {
    const doc = docs.find((d) => d.key === key);
    out[key] = doc ? doc.values.map((v) => ({ id: String(v._id), value: v.value, meaning: v.meaning || "" })) : [];
  }
  cache = out;
  return out;
}

const invalidate = () => { cache = null; };

/** Values only: { progress: ["Completed", ...], ... } */
async function getValueSets() {
  const lists = await getLists();
  return Object.fromEntries(Object.entries(lists).map(([k, vals]) => [k, vals.map((v) => v.value)]));
}

/** What the dashboard / portal need to colour and count answers. */
async function answerConfig() {
  const lists = await getLists();
  const statusSets = {};
  const statusTones = {};
  const doneStatuses = [];
  let defaultStatus = "";
  for (const [key, def] of Object.entries(form.lists)) {
    if (def.kind !== "answers") continue;
    statusSets[key] = lists[key].map((v) => v.value);
    for (const v of lists[key]) {
      const m = form.meanings[v.meaning];
      if (!(v.value in statusTones)) statusTones[v.value] = m ? m.tone : "na";
      if (v.meaning === "done" && !doneStatuses.includes(v.value)) doneStatuses.push(v.value);
      if (!defaultStatus && v.meaning === "pending") defaultStatus = v.value;
    }
  }
  if (!defaultStatus) defaultStatus = Object.values(statusSets).flat()[0] || "";
  return { statusSets, statusTones, doneStatuses, defaultStatus };
}

/** Creates the lists from formConfig defaults the first time. */
async function seedLists() {
  for (const [key, def] of Object.entries(form.lists)) {
    const exists = await OptionList.exists({ key });
    if (exists) continue;
    await OptionList.create({ key, values: def.defaults.map(([value, meaning]) => ({ value, meaning: meaning || "" })) });
    console.log(`[lists] Created dropdown list "${key}" with default values`);
  }
  invalidate();
}

module.exports = { getLists, getValueSets, answerConfig, seedLists, invalidate };
