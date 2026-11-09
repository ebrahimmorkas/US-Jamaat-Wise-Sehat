const config = require("../config");
const { isDbReady } = require("../db");
const User = require("../models/User");
const Session = require("../models/Session");
const { ACCESS_COOKIE, verifyAccess } = require("../services/auth");

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
      User.findById(payload.sub).select("username role isActive").lean(),
    ]);
    if (!session || session.revokedAt || session.expiresAt < new Date() || String(session.user) !== payload.sub) {
      return res.status(401).json({ error: "Session ended.", code: "SESSION_ENDED" });
    }
    if (!user || !user.isActive) return res.status(401).json({ error: "Account disabled.", code: "USER_INACTIVE" });

    req.user = { id: String(user._id), username: user.username, role: user.role };
    req.sessionId = payload.sid;
    next();
  } catch (err) {
    next(err);
  }
}

const requireRole = (...roles) => (req, res, next) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Not allowed.", code: "FORBIDDEN" });

// CSRF protection for state-changing requests: must come from our own website.
function requireSameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const allowed = config.corsOrigins;
  const origin = (req.get("origin") || "").replace(/\/+$/, "");
  const referer = req.get("referer") || "";
  const okOrigin = origin ? allowed.includes(origin) : allowed.some((o) => referer === o || referer.startsWith(o + "/"));
  if (!okOrigin || req.get("x-requested-with") !== "fetch") {
    return res.status(403).json({ error: "Request blocked.", code: "BAD_ORIGIN" });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireSameOrigin };
