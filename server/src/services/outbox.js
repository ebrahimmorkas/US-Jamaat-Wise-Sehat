// Sends the emails written in "Send email": every 20 seconds it picks up emails whose time has come
// (sent now = time already passed) and sends them one recipient at a time. Progress is saved per recipient,
// so after a restart it carries on where it stopped and nobody gets it twice.
const sanitizeHtml = require("sanitize-html");
const { isDbReady } = require("../db");
const EmailMessage = require("../models/EmailMessage");
const storage = require("./imagekit");
const mail = require("./email");
const vars = require("./emailVars");
const config = require("../config");

const LOCK_MS = 5 * 60 * 1000;

// Formatting kept in emails: text styles (size, colour, highlight, font, alignment), lists, links, headings,
// quotes, lines and images. Everything else (scripts, forms, events, other styles) is removed.
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i, /^[a-z]{3,20}$/i];
const SIZE = [/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/, /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large)$/];
const TEXT_STYLES = {
  color: COLOR, "background-color": COLOR, "font-size": SIZE,
  "font-weight": [/^(bold|normal|[1-9]00)$/], "font-style": [/^(italic|normal)$/],
  "text-decoration": [/^[a-z -]{3,40}$/], "text-decoration-line": [/^[a-z -]{3,40}$/],
  "font-family": [/^[a-z0-9 ,'"-]{2,80}$/i], "text-align": [/^(left|right|center|justify)$/],
  "margin-left": [/^\d{1,3}px$/], "padding-left": [/^\d{1,3}px$/],
};
const STYLED = ["p", "div", "h1", "h2", "h3", "li", "blockquote", "span", "b", "strong", "i", "em", "u", "s", "ul", "ol"];
function cleanHtml(html) {
  return sanitizeHtml(String(html || ""), {
    allowedTags: ["p", "br", "div", "span", "font", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "ul", "ol", "li", "a", "h1", "h2", "h3", "blockquote", "hr", "img"],
    allowedAttributes: {
      a: ["href", "target", "rel", "style"],
      img: ["src", "alt", "width", "style"],
      font: ["color", "size", "face"],
      ...Object.fromEntries(STYLED.map((t) => [t, ["style"]])),
    },
    allowedStyles: {
      "*": TEXT_STYLES,
      img: { width: [/^\d{1,4}(px|%)$/], "max-width": [/^\d{1,4}(px|%)$/], height: [/^auto$/, /^\d{1,4}px$/], display: [/^block$/], margin: [/^[0-9a-z %-]{1,30}$/] },
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    // Images only from a full https:// address (email apps can't load anything else).
    exclusiveFilter: (frame) => frame.tag === "img" && !/^https:\/\/\S+$/i.test(frame.attribs.src || ""),
    transformTags: {
      a: (tag, attribs) => ({ tagName: "a", attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
      img: (tag, attribs) => ({ tagName: "img", attribs: { ...attribs, style: `max-width:100%;height:auto;${(attribs.style || "").replace(/max-width:[^;]*;?|height:[^;]*;?/g, "")}` } }),
    },
  }).trim();
}
/** Plain-text version (for email apps that don't show formatting). */
function toText(html) {
  return sanitizeHtml(String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h2|h3|blockquote)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (m, href, t) => (t && t !== href ? `${t} (${href})` : href)), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const ROLE_ONE = { jamaat_coordinator: "Jamaat Coordinator", jc: "JC", saheb: "Saheb", superadmin: "Super Admin" };
/** The email as it is sent: the message inside a simple branded frame, signed with who sent it. */
/**
 * The email as it is sent to one person: variables filled, inside a simple branded frame, signed with who sent it.
 * @param {object} msg      the EmailMessage (or a template being previewed)
 * @param {object} person   the recipient ({ name }) — for the CC / BCC copy: { name: "" }
 * @param {object} values   variable values for this person (services/emailVars)
 * @param {string} [note]   a line above the message (HTML; the CC / BCC copy)
 */
function framed(msg, person, values = {}, note = "") {
  const e = mail.esc;
  const by = msg.createdBy || {};
  const sig = `${by.name || by.email || ""}${by.role ? ` (${ROLE_ONE[by.role] || by.role})` : ""}`;
  const hello = msg.greeting !== false ? (person.name ? `Salaam ${person.name},` : note ? "Salaam [name]," : "Salaam,") : "";
  const body = vars.fillHtml(msg.html, values);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1d2433;max-width:640px">
<div style="border-bottom:3px solid #1f6f43;padding:4px 0 10px;margin-bottom:16px;font-weight:bold;color:#1f6f43;font-size:16px">${e(config.contact.name || "Umoor Sehhat")}</div>
${note ? `<p style="background:#f1f5f9;border-radius:8px;padding:10px 12px;font-size:13px;color:#475569">${note}</p>` : ""}
${hello ? `<p>${e(hello)}</p>` : ""}
${body}
<p style="margin-top:24px;font-size:12.5px;color:#718096;border-top:1px solid #e2e8f0;padding-top:10px">Sent by ${e(sig)} through the Umoor Sehhat portal.${by.email ? ` Reply to this email to answer ${e(by.name || by.email)}.` : ""}</p>
</div>`;
  const text = `${note ? `${toText(note)}\n\n` : ""}${hello ? `${hello}\n\n` : ""}${toText(body)}\n\n--\nSent by ${sig} through the Umoor Sehhat portal.`;
  return { html, text, subject: vars.fillText(msg.subject, values) };
}

/** Download the attachments once per email. */
async function loadFiles(files) {
  const out = [];
  for (const f of files || []) {
    const url = storage.signedUrl(f, 1);
    if (!url) throw new Error("The attachments can't be read (file storage isn't set up).");
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`An attachment (${f.name}) couldn't be read (${res.status}).`);
    out.push({ name: f.name || "file", type: f.type || "application/octet-stream", content: Buffer.from(await res.arrayBuffer()) });
  }
  return out;
}

/** Claim one email whose time has come (or whose sender stopped) and send it. */
async function sendOne() {
  const now = new Date();
  const msg = await EmailMessage.findOneAndUpdate(
    { $or: [{ status: "scheduled", sendAt: { $lte: now } }, { status: "sending", lockedUntil: { $lt: now } }] },
    { $set: { status: "sending", lockedUntil: new Date(Date.now() + LOCK_MS) } },
    { sort: { sendAt: 1 }, returnDocument: "after" }
  ).lean();
  if (!msg) return false;
  if (!msg.startedAt) await EmailMessage.updateOne({ _id: msg._id }, { $set: { startedAt: new Date() } });

  let files = [];
  let fileError = "";
  try { files = await loadFiles(msg.files); } catch (e) { fileError = String(e.message || e); }
  let ctx = null;
  try {
    const form = msg.form ? await require("../models/Form").findById(msg.form).select("title code access startAt endAt").lean() : null;
    ctx = await vars.prepare({ users: msg.recipients.map((r) => r.user).filter(Boolean), form, sender: msg.createdBy });
  } catch (e) { fileError = fileError || `The variables couldn't be filled: ${String((e && e.message) || e)}`; }

  for (let i = 0; i < msg.recipients.length; i += 1) {
    const r = msg.recipients[i];
    if (r.status !== "pending") continue;
    // Cancelled while sending? Stop.
    if (i % 5 === 0) {
      const cur = await EmailMessage.findById(msg._id).select("status").lean();
      if (!cur || cur.status !== "sending") return true;
      await EmailMessage.updateOne({ _id: msg._id }, { $set: { lockedUntil: new Date(Date.now() + LOCK_MS) } });
    }
    let set;
    if (fileError) set = { status: "failed", error: fileError };
    else {
      try {
        const body = framed(msg, r, vars.valuesFor(ctx, r));
        const out = await mail.sendMail({ to: r.email, subject: body.subject, html: body.html, text: body.text, replyTo: msg.createdBy && msg.createdBy.email, attachments: files });
        set = { status: "sent", provider: out.provider, fellBack: out.fellBack, sentAt: new Date(), error: out.fellBack ? `Sent by the backup (${out.firstError || "first provider failed"})` : "" };
      } catch (e) { set = { status: "failed", error: String((e && e.message) || e).slice(0, 300) }; }
    }
    await EmailMessage.updateOne({ _id: msg._id }, {
      $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`recipients.${i}.${k}`, v])),
      $inc: set.status === "sent" ? { sent: 1 } : { failed: 1 },
    });
  }
  // The single copy for CC / BCC, once everyone else has theirs.
  const cur = await EmailMessage.findById(msg._id).select("status copy recipients").lean();
  if (cur && cur.status === "sending" && cur.copy && cur.copy.status === "pending") {
    let set;
    if (fileError) set = { status: "failed", error: fileError };
    else {
      try {
        const got = cur.recipients.filter((r) => r.status === "sent");
        const names = got.slice(0, 200).map((r) => mail.esc(r.name ? `${r.name} (${r.email})` : r.email)).join(", ");
        const note = `Copy for your information. This email was sent to ${got.length} ${got.length === 1 ? "person" : "people"}, each with their own details filled in${got.length ? `: ${names}${got.length > 200 ? ` and ${got.length - 200} more` : ""}` : ""}.`;
        const body = framed(msg, { name: "" }, vars.copyValues(ctx), note);
        const cc = msg.cc || [];
        const bcc = msg.bcc || [];
        await mail.sendMail({ to: cc.length ? cc : bcc, bcc: cc.length ? bcc : [], subject: body.subject, html: body.html, text: body.text, replyTo: msg.createdBy && msg.createdBy.email, attachments: files });
        set = { status: "sent", sentAt: new Date(), error: "" };
      } catch (e) { set = { status: "failed", error: String((e && e.message) || e).slice(0, 300) }; }
    }
    await EmailMessage.updateOne({ _id: msg._id }, { $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`copy.${k}`, v])) });
  }
  const done = await EmailMessage.findById(msg._id).select("sent failed status").lean();
  if (done && done.status === "sending") {
    await EmailMessage.updateOne({ _id: msg._id }, { $set: { status: done.sent === 0 && done.failed > 0 ? "failed" : "done", finishedAt: new Date(), lockedUntil: null } });
  }
  return true;
}

let running = false;
async function tick() {
  if (running || !isDbReady()) return;
  running = true;
  try { while (await sendOne()) { /* next */ } }
  catch (e) { console.error("[outbox]", e && e.message); }
  finally { running = false; }
}
/** Start now (after "Send now") without waiting for the next round. */
const kick = () => { setImmediate(() => tick()); };

function startOutbox() {
  const t = setInterval(tick, 20000);
  t.unref();
  setTimeout(tick, 3000).unref();
}

module.exports = { startOutbox, kick, tick, cleanHtml, toText, framed };
