// Audit trail and error logging. Never throws and never blocks the request.
const crypto = require("crypto");
const { isDbReady } = require("../db");
const AuditLog = require("../models/AuditLog");
const ErrorLog = require("../models/ErrorLog");
const { clientIp } = require("../lib/clientIp");

const who = (req, user) => {
  const u = user || (req && req.user) || null;
  return {
    user: u ? u.id || u._id : undefined,
    username: u ? u.email || u.username : undefined,
    role: u ? u.role : undefined,
    ip: req ? clientIp(req) : undefined,
    userAgent: req ? String(req.get("user-agent") || "").slice(0, 300) : undefined,
  };
};

/** One audit entry. `changes` = [{ field, label, from, to }] (only what changed). */
function audit(req, action, { user, username, success = true, target, changes, details } = {}) {
  if (!isDbReady()) {
    console.warn(`[audit] MongoDB not connected, not saved: ${action}`);
    return;
  }
  const base = who(req, user);
  AuditLog.create({
    action,
    success,
    ...base,
    username: username || base.username,
    target,
    changes: changes && changes.length ? changes : undefined,
    details,
  }).catch((err) => console.warn("[audit] Could not save:", err.message));
}

const norm = (v) => (v === undefined || v === "" ? null : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/**
 * Field-by-field difference for the audit trail.
 *   spec = [["houseCount", "House Count"], ["isActive", "Active"], ...]
 * Returns only the fields whose value changed: [{ field, label, from, to }].
 */
function diff(before, after, spec) {
  const out = [];
  for (const [field, label, fmt] of spec) {
    let from = before ? before[field] : null;
    let to = after ? after[field] : null;
    if (fmt) { from = fmt(from); to = fmt(to); }
    if (!same(from, to)) out.push({ field, label, from: norm(from), to: norm(to) });
  }
  return out;
}

const newRef = () => crypto.randomBytes(4).toString("hex").toUpperCase(); // e.g. "9F3A1C2B"

/** Saves an error and returns its reference (shown to the user on the Error page). */
function logError({ req, source = "server", message, stack, path, status, details, user }) {
  const ref = newRef();
  if (!isDbReady()) {
    console.warn(`[error] MongoDB not connected, error ${ref} not saved`);
    return ref;
  }
  const base = who(req, user);
  ErrorLog.create({
    ref,
    source,
    message: String(message || "Unknown error").slice(0, 1000),
    stack: stack ? String(stack).slice(0, 6000) : undefined,
    method: req && source === "server" ? req.method : undefined,
    path: String(path || (req ? req.originalUrl : "") || "").slice(0, 500),
    status,
    ...base,
    details,
  }).catch((err) => console.warn("[error] Could not save error log:", err.message));
  return ref;
}

module.exports = { audit, diff, logError };
