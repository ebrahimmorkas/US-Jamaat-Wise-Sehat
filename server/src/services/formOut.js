// Shared by the Responses page and the Coordinator's "My responses": a form's layout and responses with
// Jamiat / Jamaat names and signed file links.
const FormUpload = require("../models/FormUpload");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const storage = require("./imagekit");

/** The whole form as people saw it (headings, help, choices), to show a response like the filled form. */
const layoutOf = (form) => form.fields.map((x) => ({
  key: x.key, type: x.type, label: x.label, help: x.help || "", required: !!x.required, hidden: !!x.hidden,
  options: x.options ? x.options.map((o) => o.label) : undefined, max: x.max,
}));

const topImageOf = (form) => (form.topImage && form.topImage.url ? storage.signedUrl(form.topImage) : "");

/**
 * Responses (lean documents) -> what the website shows. Never includes database ids.
 * @param {object[]} list
 * @param {{ hours?: number }} [opt] how long file links work (default: the usual short time)
 */
async function responsesOut(list, { hours } = {}) {
  const ids = (key) => [...new Set(list.map((r) => String(r[key])).filter((x) => x && x !== "null" && x !== "undefined"))];
  const [jms, jts, ups] = await Promise.all([
    Jamaat.find({ _id: { $in: ids("jamaat") } }).select("name").lean(),
    Jamiat.find({ _id: { $in: ids("jamiat") } }).select("name").lean(),
    FormUpload.find({ response: { $in: list.map((r) => r._id) } }).select("url endpoint name size type").lean(),
  ]);
  const jmName = new Map(jms.map((x) => [String(x._id), x.name]));
  const jtName = new Map(jts.map((x) => [String(x._id), x.name]));
  const upOf = new Map(ups.map((u) => [String(u._id), u]));
  return list.map((r) => {
    const answers = {};
    for (const [k, v] of Object.entries(r.answers || {})) {
      if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && v[0].upload) {
        answers[k] = v.map((x) => { const u = upOf.get(String(x.upload)); return { name: x.name, size: x.size, type: x.type, url: u ? storage.signedUrl(u, hours) : "" }; });
      } else answers[k] = v;
    }
    return {
      submittedAt: r.createdAt, editedAt: r.editedAt || null, edits: r.edits || 0,
      email: r.email || "", name: r.name || "", verified: !!r.verified, via: r.via, isTest: !!r.isTest,
      jamiat: jtName.get(String(r.jamiat)) || "", jamaat: jmName.get(String(r.jamaat)) || "",
      answers,
    };
  });
}

module.exports = { layoutOf, topImageOf, responsesOut };
