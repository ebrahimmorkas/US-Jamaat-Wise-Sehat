// Comments JCs typed under the questions (entries.comments). The dashboards only get a count per
// Jamaat; the text itself is loaded when someone opens "Comments" (and that is logged).
const Entry = require("../models/Entry");
const { getFields, toneOf } = require("./fields");
const { monthLabel } = require("../lib/month");

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** Keys of the questions that have a (non-empty) comment in this entry. */
const commentedKeys = (entry) =>
  entry && entry.comments ? Object.keys(entry.comments).filter((k) => text(entry.comments[k])) : [];

/**
 * All comments for one month in the given Jamaats.
 * places: [{ id, name, jamiatId, jamiat }] (who may be seen is decided by the caller).
 * -> { month, monthLabel, questions: [{ key, label, group, options:[{value,tone}] }], comments: [...] }
 */
async function commentsFor(month, places) {
  const byId = new Map(places.map((p) => [String(p.id), p]));
  const [entries, fields] = await Promise.all([
    Entry.find({ month, jamaat: { $in: [...byId.keys()] }, comments: { $exists: true } })
      .select("jamaat values comments updatedAt").lean(),
    getFields(), // also questions made inactive later, so their old comments keep a label
  ]);
  const order = new Map(fields.map((f, i) => [f.key, i]));
  const comments = [];
  for (const e of entries) {
    const p = byId.get(String(e.jamaat));
    if (!p) continue;
    for (const key of commentedKeys(e)) {
      comments.push({
        jamaatId: String(p.id), jamaat: p.name, jamiatId: String(p.jamiatId), jamiat: p.jamiat,
        key, answer: (e.values && e.values[key]) || "", text: text(e.comments[key]), savedAt: e.updatedAt,
      });
    }
  }
  comments.sort((a, b) => a.jamiat.localeCompare(b.jamiat) || a.jamaat.localeCompare(b.jamaat)
    || (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
  const used = new Set(comments.map((c) => c.key));
  const questions = fields.filter((f) => used.has(f.key)).map((f) => ({
    key: f.key, label: f.label, group: f.section,
    options: f.options.map((o) => ({ value: o.value, tone: toneOf(o.meaning) })),
  }));
  return { month, monthLabel: monthLabel(month), questions, comments };
}

module.exports = { commentsFor, commentedKeys };
