// Checks shared by "Send email" and email templates: subject, formatted body, CC / BCC, variables, form.
const Form = require("../models/Form");
const { InputError } = require("../lib/validate");
const { cleanHtml, toText } = require("./outbox");
const vars = require("./emailVars");

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;
const MAX_COPY = 50;

/** CC / BCC: any email address (checked), each once. */
function addressList(v, label) {
  const raw = Array.isArray(v) ? v : String(v || "").split(/[\s,;]+/);
  const out = [...new Set(raw.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))];
  const bad = out.filter((x) => !EMAIL.test(x) || x.length > 200);
  if (bad.length) throw new InputError(`${label}: ${bad.length === 1 ? "this isn't an email address" : "these aren't email addresses"}: ${bad.slice(0, 5).join(", ")}.`);
  if (out.length > MAX_COPY) throw new InputError(`${label}: ${MAX_COPY} addresses at most.`);
  return out;
}

/** A form chosen for the {{Form …}} variables (by its code). */
async function formByCode(code) {
  const c = String(code || "").trim();
  if (!c) return null;
  const f = await Form.findOne({ code: c, status: { $ne: "D" } }).select("title code access stage startAt endAt").lean();
  if (!f) throw new InputError("The chosen form wasn't found.");
  return f;
}

/**
 * Read subject / body / CC / BCC / greeting / form from a request body.
 * @returns {Promise<{ subject, html, text, cc, bcc, greeting, form }>}
 */
async function readMessage(b, { needForm = true } = {}) {
  const subject = String(b.subject || "").replace(/\s+/g, " ").trim();
  if (!subject) throw new InputError("Write a subject.");
  if (subject.length > 200) throw new InputError("The subject is too long (200 characters at most).");
  if (String(b.html || "").length > 400000) throw new InputError("The message is too long.");
  const html = cleanHtml(b.html);
  const text = toText(html);
  if (!text && !/<img/i.test(html)) throw new InputError("Write the message.");
  const cc = addressList(b.cc, "CC");
  const bcc = addressList(b.bcc, "BCC");
  const unknown = await vars.unknownIn(subject, html);
  if (unknown.length) throw new InputError(`Unknown ${unknown.length === 1 ? "variable" : "variables"}: ${unknown.map((u) => `{{${u}}}`).join(", ")}. Use "Insert variable" to pick one, or remove the braces.`);
  const form = await formByCode(b.form);
  if (needForm && !form && vars.usesForm(subject, html)) throw new InputError("The email uses a {{Form …}} variable: choose the form it is about.");
  return { subject, html, text, cc, bcc, greeting: b.greeting !== false, form };
}

module.exports = { addressList, formByCode, readMessage, EMAIL };
