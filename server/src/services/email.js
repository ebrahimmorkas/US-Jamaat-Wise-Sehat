// Sending email. The provider is chosen in the settings (EMAIL_PROVIDER), so it can change later
// (e.g. SendGrid) without touching the code that sends:
//   smtp  any SMTP account (Gmail with an app password, Workspace, Zoho, …) through nodemailer
//   log   prints who would get what, sends nothing (for testing)
//   ""    off
// Emails go out one at a time, at most EMAIL_PER_MINUTE a minute.
const config = require("../config");

const PROVIDERS = {
  smtp: () => {
    const { host, port, user, pass } = config.email.smtp;
    if (!user || !pass) return null;
    const nodemailer = require("nodemailer");
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    return (msg) => t.sendMail(msg);
  },
  log: () => async (msg) => { console.log(`[email:log] to ${msg.to} — ${msg.subject}`); return { messageId: "log" }; },
};

let send = null;
let tried = false;
function transport() {
  if (!tried) {
    tried = true;
    const make = PROVIDERS[config.email.provider];
    send = make ? make() : null;
    if (config.email.provider && !send) console.warn(`[email] EMAIL_PROVIDER=${config.email.provider} isn't set up completely: emails are off.`);
  }
  return send;
}

/** Can emails be sent? */
const isReady = () => !!transport() && (config.email.provider === "log" || !!fromAddress());
const fromAddress = () => config.email.from || config.email.smtp.user;

// One at a time, spaced out (providers limit how fast an account may send).
let chain = Promise.resolve();
let lastAt = 0;
const gap = () => Math.ceil(60000 / Math.max(1, config.email.perMinute));

/**
 * Send one email. Resolves when it was sent; rejects with the provider's error.
 * @param {{ to: string, subject: string, text: string, html?: string }} msg
 */
function sendMail(msg) {
  const go = transport();
  if (!go || !isReady()) return Promise.reject(new Error("Email isn't set up on the server."));
  const job = chain.then(async () => {
    const wait = lastAt + gap() - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return go({ from: fromAddress(), ...(config.email.replyTo ? { replyTo: config.email.replyTo } : {}), ...msg });
  });
  chain = job.catch(() => {}); // one failure doesn't stop the next
  return job;
}

/** A date/time as written in emails, e.g. "Mon, 23 Nov 2026, 4:20 pm (India time)". */
function emailTime(d) {
  if (!d) return "";
  try {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: config.email.timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
    return `${s} (${config.email.timeZoneLabel})`;
  } catch { return `${new Date(d).toISOString().slice(0, 16).replace("T", " ")} UTC`; }
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = { isReady, sendMail, emailTime, esc };
