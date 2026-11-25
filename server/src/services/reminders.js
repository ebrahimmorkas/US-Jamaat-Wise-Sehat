// Reminders are email templates sent about a form:
//   - automatic: the rules set on the form (Form.reminders) — "when published", "X hours before closing", "at a time";
//     nothing goes out before the form is Published, and each rule is sent once.
//   - by hand:   the "Send reminder" button on the Jamaat status page (Super Admin, Saheb, JC for their Jamaats).
// Only the Jamaats that haven't filled the form are reminded (filled by the JC on their behalf counts as filled):
// their Jamaat Coordinators, and — if chosen — the JCs of those Jamaats.
// Every send is an EmailMessage (kind "reminder"), so it is in the history; Jamaat Coordinators also get it
// in their portal Notifications (services/outbox).
// Also here: the copy of a response emailed to the person who filled it (Form.sendCopy).
const { isDbReady } = require("../db");
const config = require("../config");
const Form = require("../models/Form");
const FormResponse = require("../models/FormResponse");
const EmailMessage = require("../models/EmailMessage");
const EmailTemplate = require("../models/EmailTemplate");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { notDeleted } = require("../lib/softDelete");
const { InputError } = require("../lib/validate");
const mail = require("./email");
const F = require("./forms");

const SYSTEM = () => ({ name: `${config.contact.name || "Umoor Sehhat"} (automatic)`, email: "", role: "" });

/** Jamaats (active) and which of them have filled the form (real responses, not tests). */
async function jamaatState(form, onlyIds = null) {
  const jts = await Jamiat.find({ isActive: true, ...notDeleted() }).select("name").lean();
  const jtName = new Map(jts.map((j) => [String(j._id), j.name]));
  const q = { isActive: true, ...notDeleted(), jamiat: { $in: jts.map((j) => j._id) } };
  if (onlyIds) q._id = { $in: onlyIds };
  const jms = (await Jamaat.find(q).select("name jamiat").lean()).map((j) => ({ id: String(j._id), _id: j._id, name: j.name, jamiatId: String(j.jamiat), jamiat: jtName.get(String(j.jamiat)) || "" }));
  const filled = new Set((await FormResponse.distinct("jamaat", { form: form._id, isTest: false, jamaat: { $in: jms.map((j) => j._id) } })).map(String));
  return { jms, filled };
}

/** The Jamaats a JC looks after (their Jamaats inside their Jamiats). */
function jcPlaces(u) {
  const jts = new Set((u.jamiats || []).map(String));
  return { jamaats: new Set((u.jamaats || []).map(String)), jamiats: jts };
}

/**
 * Who a reminder goes to: Jamaat Coordinators of the Jamaats that haven't filled (+ the JCs of those Jamaats).
 * @param {object} form
 * @param {{ withJc?: boolean, scope?: string[]|null }} opt  scope = only these Jamaat ids (a JC's own Jamaats, the page filters)
 */
async function audience(form, { withJc = false, scope = null } = {}) {
  const { jms, filled } = await jamaatState(form, scope);
  const open = jms.filter((j) => !filled.has(j.id));
  const openIds = new Set(open.map((j) => j.id));
  const byId = new Map(jms.map((j) => [j.id, j]));
  const coords = await User.find({ role: "jamaat_coordinator", isActive: true, email: { $nin: [null, ""] }, jamaat: { $in: open.map((j) => j._id) }, ...notDeleted() }).select("name email role jamaat").lean();
  const recipients = coords.map((c) => { const j = byId.get(String(c.jamaat)); return { user: c._id, email: c.email, name: c.name || "", role: c.role, place: j ? `${j.name} (${j.jamiat})` : "" }; });
  let jcs = 0;
  if (withJc) {
    const list = await User.find({ role: "jc", isActive: true, email: { $nin: [null, ""] }, ...notDeleted() }).select("name email role jamaats jamiats").lean();
    for (const u of list) {
      const p = jcPlaces(u);
      const mine = open.filter((j) => p.jamaats.has(j.id) && p.jamiats.has(j.jamiatId));
      if (!mine.length) continue;
      recipients.push({ user: u._id, email: u.email, name: u.name || "", role: u.role, place: mine.length === 1 ? `${mine[0].name} (${mine[0].jamiat})` : `${mine.length} Jamaats not filled` });
      jcs += 1;
    }
  }
  return { recipients, jamaats: jms.length, notFilled: open.length, withoutCoordinator: open.length - new Set(coords.map((c) => String(c.jamaat))).size, coordinators: coords.length, jcs, openIds };
}

/**
 * Create the reminder email (the outbox sends it at once).
 * @param {{ form: object, templateId: string, withJc?: boolean, scope?: string[]|null, by?: object, rule?: string, what?: string }} o
 * @returns {Promise<{ message: object|null, total: number, notFilled: number }>}
 */
async function createReminder({ form, templateId, withJc = false, scope = null, by = null, rule = "", what = "" }) {
  const t = await EmailTemplate.findOne({ _id: templateId, ...notDeleted() }).lean();
  if (!t) throw new InputError("The reminder template wasn't found (it may have been deleted).");
  const a = await audience(form, { withJc, scope });
  if (!a.recipients.length) return { message: null, total: 0, notFilled: a.notFilled };
  const m = await EmailMessage.create({
    kind: "reminder", subject: t.subject, html: t.html, text: "", cc: t.cc || [], bcc: t.bcc || [], greeting: t.greeting !== false,
    form: form._id, template: t._id, templateName: t.name, rule,
    audience: `${what || "Reminder"}: ${a.notFilled} Jamaat${a.notFilled === 1 ? "" : "s"} not filled — Jamaat Coordinators${withJc ? " + JCs" : ""}`,
    files: t.files || [], copy: { status: (t.cc || []).length || (t.bcc || []).length ? "pending" : "none" },
    recipients: a.recipients.map((r) => ({ ...r, status: "pending" })), total: a.recipients.length,
    status: "scheduled", sendAt: new Date(), createdBy: by || SYSTEM(),
  });
  require("./outbox").kick();
  return { message: m, total: a.recipients.length, notFilled: a.notFilled };
}

// ---------- automatic rules ----------
const RULE_TEXT = (r) => (r.when === "publish" ? "When published" : r.when === "before_close" ? `${hoursText(r.hours)} before closing` : `On ${mail.emailTime(r.at)}`);
function hoursText(h) {
  const d = Math.floor(h / 24);
  const x = h % 24;
  return [d ? `${d} day${d === 1 ? "" : "s"}` : "", x ? `${x} hour${x === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "0 hours";
}
/** When a rule is due (null = not yet known). */
function dueAt(form, r) {
  if (r.when === "publish") return form.publishedAt || null;
  if (r.when === "before_close") return form.endAt ? new Date(new Date(form.endAt).getTime() - r.hours * 3600000) : null;
  return r.at ? new Date(r.at) : null;
}

async function runRules() {
  const now = new Date();
  const forms = await Form.find({ stage: "published", ...notDeleted(), reminders: { $elemMatch: { "state.status": { $in: [null, "waiting"] } } } }).lean();
  for (const form of forms) {
    for (const r of form.reminders || []) {
      if (r.state && r.state.status && r.state.status !== "waiting") continue;
      const due = dueAt(form, r);
      if (!due || due > now) continue;
      // Claim it (another server / tick never sends it twice).
      const claimed = await Form.updateOne(
        { _id: form._id, stage: "published", reminders: { $elemMatch: { key: r.key, "state.status": { $in: [null, "waiting"] } } } },
        { $set: { "reminders.$.state": { status: "sending", at: now } } }
      );
      if (!claimed.modifiedCount) continue;
      let state;
      const closed = form.endAt && new Date(form.endAt) <= now;
      const missed = r.when !== "publish" && form.publishedAt && due < new Date(new Date(form.publishedAt).getTime() - 60000);
      if (closed) state = { status: "skipped", at: now, note: "Not sent: the form had already closed." };
      else if (missed) state = { status: "skipped", at: now, note: "Not sent: this time had passed before the form was published. Use \"Send reminder\" to send it now." };
      else {
        try {
          const out = await createReminder({ form, templateId: r.template, withJc: r.audience === "with_jc", rule: r.key, what: RULE_TEXT(r) });
          state = out.message
            ? { status: "sent", at: now, message: out.message._id, total: out.total, note: `${out.notFilled} Jamaat${out.notFilled === 1 ? "" : "s"} not filled` }
            : { status: "sent", at: now, total: 0, note: out.notFilled ? "Nobody to send to: the Jamaats not filled have no Jamaat Coordinator yet." : "Nobody to remind: every Jamaat had filled the form." };
        } catch (e) { state = { status: "failed", at: now, note: String((e && e.message) || e).slice(0, 300) }; }
      }
      await Form.updateOne({ _id: form._id, "reminders.key": r.key }, { $set: { "reminders.$.state": state } });
    }
  }
}

let running = false;
async function tick() {
  if (running || !isDbReady()) return;
  running = true;
  try { await runRules(); } catch (e) { console.error("[reminders]", e && e.message); } finally { running = false; }
}
const kickRules = () => setImmediate(() => tick());
function startReminders() {
  const t = setInterval(tick, 60000);
  t.unref();
  setTimeout(tick, 5000).unref();
}

// ---------- copy of a response ----------
const isLayout = (f) => !!(F.TYPES[f.type] && F.TYPES[f.type].layout); // headings, information text
function answerText(v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? x.name || "" : String(x))).filter(Boolean).join(", ");
  if (typeof v === "object") return v.name || JSON.stringify(v);
  return String(v);
}
/**
 * Email the person a copy of what they sent (Form.sendCopy). Goes through the history like every email.
 * @param {object} form  the form (lean)
 * @param {object} r     the saved response
 * @param {{ edited: boolean, jamaatName?: string, byJc?: object }} o
 */
async function sendResponseCopy(form, r, { edited = false, jamaatName = "", byJc = null } = {}) {
  if (!form.sendCopy || r.isTest || !r.email || !F.simpleEmail(r.email)) return;
  const e = mail.esc;
  const rows = form.fields.filter((f) => !f.hidden && !isLayout(f))
    .map((f) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;color:#475569;width:40%">${e(f.label || "")}</td><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top">${e(answerText((r.answers || {})[f.key])).replace(/\n/g, "<br>") || "<span style=\"color:#94a3b8\">—</span>"}</td></tr>`)
    .join("");
  const when = mail.emailTime(edited ? r.editedAt || new Date() : r.createdAt || new Date());
  const html = `<p>${edited ? "Your response was changed" : "Thank you, your response was received"} on ${e(when)}.${jamaatName ? ` Jamaat: <b>${e(jamaatName)}</b>.` : ""}</p>`
    + `${byJc ? `<p>Filled by your JC <b>${e(byJc.name || byJc.email)}</b> on your behalf.</p>` : ""}`
    + `<h3>${e(form.title)}</h3><table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>`;
  const user = await User.findOne({ email: r.email, ...notDeleted() }).select("_id role").lean();
  await EmailMessage.create({
    kind: "response_copy", subject: `${edited ? "Your changed response" : "Your response"}: ${form.title}`, html, text: "",
    greeting: !!r.name, form: form._id, audience: `Copy of a response (${jamaatName || r.email})`,
    recipients: [{ user: user ? user._id : undefined, email: r.email, name: r.name || "", role: user ? user.role : "", place: jamaatName, status: "pending" }], total: 1,
    status: "scheduled", sendAt: new Date(), createdBy: SYSTEM(),
  });
  require("./outbox").kick();
}

module.exports = { audience, createReminder, startReminders, kickRules, tick, dueAt, RULE_TEXT, hoursText, sendResponseCopy, jamaatState, jcPlaces };
