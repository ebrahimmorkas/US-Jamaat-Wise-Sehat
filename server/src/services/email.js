// Sending email through a provider that can be switched at any time.
//
//   nodemailer  any SMTP account (Gmail with an app password, Workspace, Zoho, …). Free. The DEFAULT,
//               and the BACKUP: if another provider fails (e.g. unpaid, limit reached, down), the same
//               email is sent again through nodemailer.
//   sendgrid    SendGrid's web API (SENDGRID_API_KEY).
//   log         prints instead of sending (testing only; EMAIL_PROVIDER=log).
//
// Which one sends: the Super Admin's choice in the portal (Emails → Settings), else EMAIL_PROVIDER, else nodemailer.
// Passwords and API keys are only in the server settings, never in the database or the website.
// To add a provider later: add it to PROVIDERS (configured(), send(msg)) — nothing else changes.
const config = require("../config");
const AppSetting = require("../models/AppSetting");

const fromOf = (p) => (p === "sendgrid" ? config.email.sendgrid.from || config.email.from : config.email.from || config.email.smtp.user);

/** "Name <a@b.c>" -> { name, email } */
function parseFrom(s) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(s || ""));
  return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2].trim() } : { name: "", email: String(s || "").trim() };
}

let smtpTransport = null;
const PROVIDERS = {
  nodemailer: {
    label: "Nodemailer (SMTP)",
    configured: () => !!(config.email.smtp.user && config.email.smtp.pass),
    perMinute: () => config.email.perMinute,
    async send(msg) {
      if (!smtpTransport) {
        const nodemailer = require("nodemailer");
        const { host, port, user, pass } = config.email.smtp;
        smtpTransport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
      }
      const out = await smtpTransport.sendMail({
        from: fromOf("nodemailer"), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html,
        ...(msg.replyTo || config.email.replyTo ? { replyTo: msg.replyTo || config.email.replyTo } : {}),
        attachments: (msg.attachments || []).map((a) => ({ filename: a.name, content: a.content, contentType: a.type })),
      });
      return { id: out.messageId || "" };
    },
  },
  sendgrid: {
    label: "SendGrid",
    configured: () => !!(config.email.sendgrid.apiKey && fromOf("sendgrid")),
    perMinute: () => config.email.sendgrid.perMinute,
    async send(msg) {
      const from = parseFrom(fromOf("sendgrid"));
      const replyTo = msg.replyTo || config.email.replyTo;
      const body = {
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: from.email, ...(from.name ? { name: from.name } : {}) },
        ...(replyTo ? { reply_to: parseFrom(replyTo) } : {}),
        subject: msg.subject,
        content: [{ type: "text/plain", value: msg.text || " " }, ...(msg.html ? [{ type: "text/html", value: msg.html }] : [])],
        ...(msg.attachments && msg.attachments.length ? {
          attachments: msg.attachments.map((a) => ({ filename: a.name, type: a.type || "application/octet-stream", disposition: "attachment", content: Buffer.from(a.content).toString("base64") })),
        } : {}),
      };
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.email.sendgrid.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const why = (j.errors || []).map((e) => e.message).filter(Boolean).join("; ");
        throw new Error(`SendGrid refused the email (${res.status}${why ? `: ${why}` : ""}).`);
      }
      return { id: res.headers.get("x-message-id") || "" };
    },
  },
  log: {
    label: "Log only (testing)",
    configured: () => config.email.provider === "log",
    perMinute: () => 100000,
    async send(msg) { console.log(`[email:log] to ${msg.to} — ${msg.subject}${msg.attachments && msg.attachments.length ? ` (+${msg.attachments.length} file)` : ""}`); return { id: "log" }; },
  },
};
const DEFAULT = "nodemailer";
const NAMES = ["nodemailer", "sendgrid"]; // shown in the portal

// ---------- which provider is active ----------
let chosen = null; // the Super Admin's choice (cached)
let chosenAt = 0;
async function activeName() {
  if (Date.now() - chosenAt > 30000) {
    try { const s = await AppSetting.findOne({ key: "email.provider" }).lean(); chosen = s ? s.value : null; } catch { /* db not ready: keep */ }
    chosenAt = Date.now();
  }
  const envName = config.email.provider === "smtp" ? "nodemailer" : config.email.provider;
  if (envName === "log") return "log"; // testing overrides everything
  return PROVIDERS[chosen] ? chosen : PROVIDERS[envName] ? envName : DEFAULT;
}
async function setActive(name, by) {
  if (!NAMES.includes(name)) throw new Error("Unknown email provider.");
  await AppSetting.updateOne({ key: "email.provider" }, { $set: { value: name, updatedBy: by } }, { upsert: true });
  chosen = name; chosenAt = Date.now();
}

/** What the settings page shows. */
async function status() {
  const active = await activeName();
  return {
    active,
    fallback: DEFAULT,
    providers: NAMES.map((n) => ({ name: n, label: PROVIDERS[n].label, configured: PROVIDERS[n].configured(), from: fromOf(n) || "" })),
    testing: active === "log",
  };
}

/** Can emails be sent at all (the active provider, or the backup)? */
const isReady = () => {
  if (config.email.provider === "log") return true;
  return NAMES.some((n) => PROVIDERS[n].configured());
};

// ---------- sending: one at a time per provider, spaced out ----------
const lanes = {};
function lane(name) {
  if (!lanes[name]) lanes[name] = { chain: Promise.resolve(), lastAt: 0 };
  return lanes[name];
}
function viaProvider(name, msg) {
  const p = PROVIDERS[name];
  const l = lane(name);
  const gap = Math.ceil(60000 / Math.max(1, p.perMinute()));
  const job = l.chain.then(async () => {
    const wait = l.lastAt + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    l.lastAt = Date.now();
    return p.send(msg);
  });
  l.chain = job.catch(() => {}); // one failure doesn't stop the next
  return job;
}

/**
 * Send one email with the active provider; if it isn't set up or fails, with nodemailer (the backup).
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string,
 *           attachments?: { name: string, type: string, content: Buffer }[] }} msg
 * @param {{ provider?: string }} [opt] force one provider (the settings page's test email); no backup then
 * @returns {Promise<{ provider: string, id: string, fellBack: boolean, firstError?: string }>}
 */
async function sendMail(msg, opt = {}) {
  if (opt.provider) {
    const p = PROVIDERS[opt.provider];
    if (!p || !p.configured()) throw new Error(`${p ? p.label : "That provider"} isn't set up on the server.`);
    const r = await viaProvider(opt.provider, msg);
    return { provider: opt.provider, id: r.id, fellBack: false };
  }
  const first = await activeName();
  let firstError = "";
  if (PROVIDERS[first].configured()) {
    try { const r = await viaProvider(first, msg); return { provider: first, id: r.id, fellBack: false }; }
    catch (e) { firstError = String((e && e.message) || e).slice(0, 300); if (first === DEFAULT) throw e; }
  } else firstError = `${PROVIDERS[first].label} isn't set up on the server.`;
  // Backup: nodemailer.
  if (first !== DEFAULT && PROVIDERS[DEFAULT].configured()) {
    if (firstError) console.warn(`[email] ${PROVIDERS[first].label} failed (${firstError}); sending with ${PROVIDERS[DEFAULT].label} instead.`);
    const r = await viaProvider(DEFAULT, msg);
    return { provider: DEFAULT, id: r.id, fellBack: true, firstError };
  }
  throw new Error(firstError || "Email isn't set up on the server.");
}

/** A date/time as written in emails, e.g. "Mon, 23 Nov 2026, 4:20 pm (India time)". */
function emailTime(d) {
  if (!d) return "";
  try {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: config.email.timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(d));
    return `${s} (${config.email.timeZoneLabel})`;
  } catch { return `${new Date(d).toISOString().slice(0, 16).replace("T", " ")} UTC`; }
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = { isReady, sendMail, status, setActive, activeName, emailTime, esc, PROVIDERS, NAMES };
