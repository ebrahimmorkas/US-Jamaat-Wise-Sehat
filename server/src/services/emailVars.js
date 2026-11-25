// Variables in emails and templates: {{Coordinator name}}, {{Form link}}, {{Aamil Saheb}} …
// Each is filled in separately for every person the email goes to.
//
//   Fixed:  the person, their Jamaat (and its Jamaat Coordinator), the chosen form, times, contact details (.env)
//   Data:   every column of the uploaded Data Excel (e.g. Aamil Saheb, Tibb Lead, …), from the person's Jamaat's row.
//           A new upload with new columns adds new variables on its own.
//
// Times are written in the person's Jamaat's time zone (not tagged yet -> India time).
const config = require("../config");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { DataConfig, DataRow } = require("../models/DataSheet");
const { notDeleted } = require("../lib/softDelete");
const F = require("./forms");
const mail = require("./email");

const FIXED = [
  { key: "Recipient name", group: "Person", hint: "Name of the person who gets the email" },
  { key: "Recipient email", group: "Person", hint: "Their Gmail" },
  { key: "Recipient role", group: "Person", hint: "Jamaat Coordinator, JC, Saheb …" },
  { key: "Jamaat", group: "Jamaat", hint: "Their Jamaat" },
  { key: "Jamiat", group: "Jamaat", hint: "Their Jamiat" },
  { key: "Coordinator name", group: "Jamaat", hint: "The Jamaat Coordinator of their Jamaat" },
  { key: "Coordinator email", group: "Jamaat", hint: "… and their Gmail" },
  { key: "Form title", group: "Form", hint: "The form chosen when sending" },
  { key: "Form link", group: "Form", hint: "Each person's own link to fill it" },
  { key: "Form opens", group: "Form", hint: "Date and time, in their own time zone" },
  { key: "Form closes", group: "Form", hint: "Date and time, in their own time zone" },
  { key: "Time remaining", group: "Form", hint: "Time left until the form closes, worked out when sent (e.g. 2 days 5 hours)" },
  { key: "Today", group: "Time", hint: "The date it is sent" },
  { key: "Send time", group: "Time", hint: "Date and time it is sent, in their own time zone" },
  { key: "Sender name", group: "Contact", hint: "Who sends the email" },
  { key: "Contact name", group: "Contact", hint: "From the server settings (CONTACT_NAME)" },
  { key: "Contact email", group: "Contact", hint: "CONTACT_EMAIL" },
  { key: "Contact phone", group: "Contact", hint: "CONTACT_PHONE" },
  { key: "Contact WhatsApp", group: "Contact", hint: "CONTACT_WHATSAPP" },
  { key: "Contact address", group: "Contact", hint: "CONTACT_ADDRESS" },
  { key: "Contact website", group: "Contact", hint: "CONTACT_WEBSITE" },
];
const ROLE_ONE = { jamaat_coordinator: "Jamaat Coordinator", jc: "JC", saheb: "Saheb", superadmin: "Super Admin", media: "Media" };
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

/** Columns of the current Data Excel (not its Jamiat / Jamaat columns). */
async function dataColumns() {
  const cfg = await DataConfig.findOne({ key: "main" }).lean();
  if (!cfg || !cfg.version) return { cfg: null, cols: [] };
  const fixed = new Set(FIXED.map((v) => norm(v.key)));
  const cols = cfg.columns
    .map((c, i) => ({ i, key: String(c.name || "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim() }))
    .filter((c) => c.key && c.i !== cfg.jamiatCol && c.i !== cfg.jamaatCol && !fixed.has(norm(c.key)));
  return { cfg, cols };
}

/** Every variable that can be used (for the editor's "Insert variable" menu). */
async function list() {
  const { cols } = await dataColumns();
  return [...FIXED, ...cols.map((c) => ({ key: c.key, group: "Data (Excel)", hint: "From the Data Excel, for their Jamaat" }))];
}

// ---------- times ----------
/** "2 days 5 hours", "3 hours 20 minutes", "45 minutes"; "closed" once the end has passed. */
function remaining(end, now) {
  if (!end) return "";
  let m = Math.floor((new Date(end).getTime() - new Date(now).getTime()) / 60000);
  if (m <= 0) return "closed";
  const d = Math.floor(m / 1440); m -= d * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  const p = (n, w) => (n ? `${n} ${w}${n === 1 ? "" : "s"}` : "");
  return (d ? [p(d, "day"), p(h, "hour")] : h ? [p(h, "hour"), p(m, "minute")] : [p(m, "minute")]).filter(Boolean).join(" ");
}
const TZ_LABEL = { "Asia/Kolkata": "India time" };
const tzLabel = (tz) => TZ_LABEL[tz] || `${String(tz).split("/").pop().replace(/_/g, " ")} time`;
function timeIn(d, tz, { date = false } = {}) {
  if (!d) return "";
  const zone = tz || config.email.timeZone;
  try {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", year: "numeric", ...(date ? {} : { hour: "numeric", minute: "2-digit", hour12: true }) }).format(new Date(d));
    return date ? s : `${s} (${zone === config.email.timeZone ? config.email.timeZoneLabel : tzLabel(zone)})`;
  } catch { return mail.emailTime(d); }
}

/**
 * Everything needed to fill the variables for these people (loaded once per email).
 * @param {{ users: string[], form?: object|null, sender?: object }} opt
 */
async function prepare({ users = [], form = null, sender = null }) {
  const people = await User.find({ _id: { $in: users } }).select("name email role jamaat jamaats jamiats").lean();
  const [jms, jts, coords, { cfg, cols }] = await Promise.all([
    Jamaat.find({ ...notDeleted() }).select("name jamiat timeZone").lean(),
    Jamiat.find({ ...notDeleted() }).select("name").lean(),
    User.find({ role: "jamaat_coordinator", isActive: true, ...notDeleted() }).select("name email jamaat").lean(),
    dataColumns(),
  ]);
  const jtName = new Map(jts.map((j) => [String(j._id), j.name]));
  const jamaat = new Map(jms.map((j) => [String(j._id), { name: j.name, jamiat: jtName.get(String(j.jamiat)) || "", timeZone: j.timeZone || "" }]));
  const coordOf = new Map();
  for (const c of coords) if (c.jamaat && !coordOf.has(String(c.jamaat))) coordOf.set(String(c.jamaat), c);
  // Data rows of the Jamaats involved (several rows of one Jamaat are joined).
  const placeOf = new Map(people.map((p) => [String(p._id), placeFor(p)]));
  const ids = [...new Set([...placeOf.values()].filter(Boolean))];
  const data = new Map();
  if (cfg && cols.length && ids.length) {
    const rows = await DataRow.find({ version: cfg.version, jamaat: { $in: ids } }).select("jamaat cells order").sort({ order: 1 }).lean();
    for (const r of rows) {
      const k = String(r.jamaat);
      if (!data.has(k)) data.set(k, {});
      const m = data.get(k);
      for (const c of cols) {
        const v = String(r.cells[c.i] == null ? "" : r.cells[c.i]).trim();
        if (v) m[c.key] = m[c.key] && !m[c.key].split(", ").includes(v) ? `${m[c.key]}, ${v}` : m[c.key] || v;
      }
    }
  }
  return { people: new Map(people.map((p) => [String(p._id), p])), placeOf, jamaat, coordOf, data, cols, form, sender, now: new Date() };
}

/** The one Jamaat a person belongs to (a Jamaat Coordinator; a JC with exactly one Jamaat). */
function placeFor(u) {
  if (!u) return null;
  if (u.role === "jamaat_coordinator" && u.jamaat) return String(u.jamaat);
  if (u.role === "jc" && Array.isArray(u.jamaats) && u.jamaats.length === 1) return String(u.jamaats[0]);
  return null;
}

/** The values for one person ({ "Recipient name": "…", "Form link": "https://…", … }). */
function valuesFor(ctx, recipient) {
  const u = ctx.people.get(String(recipient.user)) || { name: recipient.name, email: recipient.email, role: recipient.role };
  const pid = ctx.placeOf.get(String(recipient.user)) || null;
  const place = pid ? ctx.jamaat.get(pid) : null;
  const tz = (place && place.timeZone) || config.email.timeZone;
  const coord = pid ? ctx.coordOf.get(pid) : null;
  const f = ctx.form;
  const c = config.contact;
  const v = {
    "Recipient name": u.name || "", "Recipient email": u.email || recipient.email || "", "Recipient role": ROLE_ONE[u.role] || "",
    Jamaat: place ? place.name : "", Jamiat: place ? place.jamiat : "",
    "Coordinator name": coord ? coord.name || "" : "", "Coordinator email": coord ? coord.email || "" : "",
    "Form title": f ? f.title : "",
    "Form link": f ? (f.access === "personal_link" && (u.email || recipient.email) ? F.personalLink(f.code, u.email || recipient.email) : F.formLink(f.code)) : "",
    "Form opens": f ? timeIn(f.startAt, tz) : "", "Form closes": f ? timeIn(f.endAt, tz) : "",
    "Time remaining": f ? remaining(f.endAt, ctx.now) : "",
    Today: timeIn(ctx.now, tz, { date: true }), "Send time": timeIn(ctx.now, tz),
    "Sender name": (ctx.sender && (ctx.sender.name || ctx.sender.email)) || "",
    "Contact name": c.name, "Contact email": c.email, "Contact phone": c.phone, "Contact WhatsApp": c.whatsapp, "Contact address": c.address, "Contact website": c.website,
  };
  const d = pid ? ctx.data.get(pid) || {} : {};
  for (const col of ctx.cols) v[col.key] = d[col.key] || "";
  return v;
}

/** The values for the single CC / BCC copy: person-specific ones are shown as [Name]. */
function copyValues(ctx) {
  const v = valuesFor(ctx, { user: null, name: "", email: "" });
  const generic = ["Recipient name", "Recipient email", "Recipient role", "Jamaat", "Jamiat", "Coordinator name", "Coordinator email", ...ctx.cols.map((c) => c.key)];
  for (const k of generic) v[k] = `[${k}]`;
  // The general link (a personal-link form asks to sign in); the note says each person got their own.
  if (ctx.form) v["Form link"] = F.formLink(ctx.form.code);
  return v;
}

const esc = mail.esc;
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const lookup = (values) => {
  const m = new Map(Object.entries(values).map(([k, x]) => [norm(k), x]));
  return (name) => (m.has(norm(name)) ? m.get(norm(name)) : null);
};
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);

/** Fill the variables in plain text (subject). Unknown variables are left as they are. */
function fillText(s, values) {
  const get = lookup(values);
  return String(s || "").replace(TOKEN, (m, name) => { const x = get(name); return x == null ? m : x; });
}

/** Fill the variables in the (cleaned) HTML body: escaped; links become clickable. */
function fillHtml(html, values) {
  const get = lookup(values);
  let s = String(html || "");
  // Inside a link's address (a link whose address is {{Form link}}): the raw value.
  s = s.replace(/(href=")([^"]*)(")/gi, (m, a, url, b) => {
    const u = url.replace(/%7B%7B(.+?)%7D%7D/gi, (x, n) => `{{${decodeURIComponent(n)}}}`)
      .replace(TOKEN, (x, n) => { const v = get(n); return v == null ? x : esc(v); });
    return a + u + b;
  });
  // In the text.
  return s.replace(TOKEN, (m, name) => {
    const v = get(name);
    if (v == null) return m;
    if (isUrl(v)) return `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>`;
    return esc(v).replace(/\r?\n/g, "<br>");
  });
}

/** Variables used that don't exist (shown as a warning when saving / sending). */
async function unknownIn(...texts) {
  const keys = new Set((await list()).map((v) => norm(v.key)));
  const out = new Set();
  for (const t of texts) {
    const s = String(t || "").replace(/%7B%7B(.+?)%7D%7D/gi, (x, n) => `{{${decodeURIComponent(n)}}}`);
    for (const m of s.matchAll(TOKEN)) if (!keys.has(norm(m[1]))) out.add(m[1].trim());
  }
  return [...out];
}
/** Does the text use any Form variable? */
const usesForm = (...texts) => texts.some((t) => /\{\{\s*(form (title|link|opens|closes)|time\s*remaining)\s*\}\}|%7B%7B(form|time%20remaining)/i.test(String(t || "")));

const FORM_VARS = new Set(["form title", "form link", "form opens", "form closes", "time remaining"]);
const isFormVar = (k) => FORM_VARS.has(norm(k));

module.exports = { isFormVar, remaining, FIXED, list, prepare, valuesFor, copyValues, fillText, fillHtml, unknownIn, usesForm, timeIn, placeFor };
