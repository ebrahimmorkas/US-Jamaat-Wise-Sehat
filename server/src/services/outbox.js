// Sends the emails written in "Send email": every 20 seconds it picks up emails whose time has come
// (sent now = time already passed) and sends them one recipient at a time. Progress is saved per recipient,
// so after a restart it carries on where it stopped and nobody gets it twice.
const sanitizeHtml = require("sanitize-html");
const { isDbReady } = require("../db");
const EmailMessage = require("../models/EmailMessage");
const storage = require("./imagekit");
const mail = require("./email");

const LOCK_MS = 5 * 60 * 1000;

/** Only safe formatting is kept (bold, italic, lists, links, headings, quotes). */
function cleanHtml(html) {
  return sanitizeHtml(String(html || ""), {
    allowedTags: ["p", "br", "div", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "a", "h2", "h3", "blockquote"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
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
function framed(msg, person) {
  const e = mail.esc;
  const by = msg.createdBy || {};
  const sig = `${by.name || by.email || ""}${by.role ? ` (${ROLE_ONE[by.role] || by.role})` : ""}`;
  const hello = person.name ? `Salaam ${person.name},` : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1d2433;max-width:620px">
<div style="border-bottom:3px solid #1f6f43;padding:4px 0 10px;margin-bottom:16px;font-weight:bold;color:#1f6f43;font-size:16px">Umoor Sehhat</div>
${hello ? `<p>${e(hello)}</p>` : ""}
${msg.html}
<p style="margin-top:24px;font-size:12.5px;color:#718096;border-top:1px solid #e2e8f0;padding-top:10px">Sent by ${e(sig)} through the Umoor Sehhat portal.${by.email ? ` Reply to this email to answer ${e(by.name || by.email)}.` : ""}</p>
</div>`;
  const text = `${hello ? `${hello}\n\n` : ""}${msg.text}\n\n--\nSent by ${sig} through the Umoor Sehhat portal.`;
  return { html, text };
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
        const body = framed(msg, r);
        const out = await mail.sendMail({ to: r.email, subject: msg.subject, html: body.html, text: body.text, replyTo: msg.createdBy && msg.createdBy.email, attachments: files });
        set = { status: "sent", provider: out.provider, fellBack: out.fellBack, sentAt: new Date(), error: out.fellBack ? `Sent by the backup (${out.firstError || "first provider failed"})` : "" };
      } catch (e) { set = { status: "failed", error: String((e && e.message) || e).slice(0, 300) }; }
    }
    await EmailMessage.updateOne({ _id: msg._id }, {
      $set: Object.fromEntries(Object.entries(set).map(([k, v]) => [`recipients.${i}.${k}`, v])),
      $inc: set.status === "sent" ? { sent: 1 } : { failed: 1 },
    });
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
