const { isDbReady } = require("../db");
const AuditLog = require("../models/AuditLog");
const { clientIp } = require("../lib/clientIp");

// Writes one audit entry. Never throws and never blocks the request.
function audit(req, action, { user, username, success = true, details } = {}) {
  if (!isDbReady()) {
    console.warn(`[audit] MongoDB not connected, not saved: ${action} ${username || (user && user.username) || ""}`);
    return;
  }
  const u = user || req.user || null;
  AuditLog.create({
    action,
    success,
    user: u ? u.id || u._id : undefined,
    username: username || (u && u.username) || undefined,
    role: u ? u.role : undefined,
    ip: req ? clientIp(req) : undefined,
    userAgent: req ? String(req.get("user-agent") || "").slice(0, 300) : undefined,
    details,
  }).catch((err) => console.warn("[audit] Could not save:", err.message));
}

module.exports = { audit };
