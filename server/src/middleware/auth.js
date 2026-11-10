const config = require("../config");
const { isDbReady } = require("../db");
const User = require("../models/User");
const Session = require("../models/Session");
const { ACCESS_COOKIE, verifyAccess } = require("../services/auth");
const { audit } = require("../services/audit");

// Requires a valid access token cookie AND an active session (so logout works immediately).
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[ACCESS_COOKIE];
  if (!token) return res.status(401).json({ error: "Please sign in.", code: "NO_TOKEN" });

  let payload;
  try {
    payload = verifyAccess(token);
  } catch (err) {
    const expired = err.name === "TokenExpiredError";
    return res.status(401).json({ error: expired ? "Session expired." : "Invalid session.", code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID" });
  }

  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment.", code: "DB_UNAVAILABLE" });

  try {
    const [session, user] = await Promise.all([
      Session.findById(payload.sid).select("revokedAt expiresAt user").lean(),
      User.findById(payload.sub).select("username email name role isActive").lean(),
    ]);
    if (!session || session.revokedAt || session.expiresAt < new Date() || String(session.user) !== payload.sub) {
      return res.status(401).json({ error: "Session ended.", code: "SESSION_ENDED" });
    }
    // Accounts without a Gmail (old username/password accounts) can no longer use the site.
    if (!user || !user.isActive || !user.email) {
      return res.status(401).json({ error: "Account disabled.", code: "USER_INACTIVE" });
    }

    req.user = { id: String(user._id), username: user.email, email: user.email, name: user.name || "", role: user.role };
    req.sessionId = payload.sid;
    next();
  } catch (err) {
    next(err);
  }
}

// Like requireAuth, but never refuses: sets req.user when a valid session exists (used for error reports).
async function optionalAuth(req, res, next) {
  const token = req.cookies && req.cookies[ACCESS_COOKIE];
  if (!token || !isDbReady()) return next();
  try {
    const payload = verifyAccess(token);
    const user = await User.findById(payload.sub).select("email name role isActive").lean();
    if (user && user.isActive && user.email) {
      req.user = { id: String(user._id), username: user.email, email: user.email, name: user.name || "", role: user.role };
    }
  } catch { /* not signed in */ }
  next();
}

// Role check. A refusal is saved in the audit log as "access_denied".
const requireRole = (...roles) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) return next();
  audit(req, "access_denied", { success: false, details: { method: req.method, path: req.originalUrl.slice(0, 300), allowedRoles: roles } });
  res.status(403).json({ error: "You don't have access to this.", code: "FORBIDDEN" });
};

// CSRF protection for state-changing requests: must come from our own website.
function requireSameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  // The website addresses in CORS_ORIGIN, plus this server's own address
  // (e.g. http://localhost:5000 when the server shows the website itself).
  const allowed = [...config.corsOrigins, `${req.protocol}://${req.get("host")}`];
  const origin = (req.get("origin") || "").replace(/\/+$/, "");
  const referer = req.get("referer") || "";
  const okOrigin = origin ? allowed.includes(origin) : allowed.some((o) => referer === o || referer.startsWith(o + "/"));
  if (!okOrigin || req.get("x-requested-with") !== "fetch") {
    audit(req, "access_denied", { success: false, details: { reason: "request_from_another_site", method: req.method, path: req.originalUrl.slice(0, 300), origin: origin.slice(0, 200) || referer.slice(0, 200) } });
    return res.status(403).json({ error: "Request blocked.", code: "BAD_ORIGIN" });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireRole, requireSameOrigin };
