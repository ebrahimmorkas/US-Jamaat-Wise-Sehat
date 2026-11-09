const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const config = require("../config");
const { isDbReady } = require("../db");
const User = require("../models/User");
const auth = require("../services/auth");
const { audit } = require("../services/audit");
const { requireAuth } = require("../middleware/auth");
const { clientIp } = require("../lib/clientIp");

const router = express.Router();
const byIp = (req) => ipKeyGenerator(clientIp(req));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, keyGenerator: byIp,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many sign-in attempts from this network. Try again in 15 minutes.", code: "RATE_LIMITED" },
});
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, keyGenerator: byIp,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many requests.", code: "RATE_LIMITED" },
});

const dbGuard = (req, res, next) =>
  isDbReady() ? next() : res.status(503).json({ error: "Database is starting, please try again in a moment.", code: "DB_UNAVAILABLE" });

// ---------- POST /api/auth/login ----------
router.post("/login", loginLimiter, dbGuard, async (req, res, next) => {
  try {
    const username = String((req.body && req.body.username) || "").trim().toLowerCase().slice(0, 64);
    const password = String((req.body && req.body.password) || "").slice(0, 200);
    if (!username || !password) return res.status(400).json({ error: "Enter your username and password.", code: "MISSING_FIELDS" });

    const user = await User.findOne({ username }).select("+passwordHash");

    if (user && user.lockUntil && user.lockUntil > new Date()) {
      const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
      audit(req, "login_blocked", { user: user.toPublic(), success: false, details: { minutesLeft: mins } });
      return res.status(429).json({ error: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, code: "LOCKED" });
    }

    const passwordOk = await auth.verifyPassword(password, user ? user.passwordHash : auth.DUMMY_HASH);

    if (!user || !passwordOk || !user.isActive) {
      if (user && !passwordOk) {
        user.failedLoginCount = (user.failedLoginCount || 0) + 1;
        if (user.failedLoginCount >= config.maxFailedLogins) {
          user.lockUntil = new Date(Date.now() + config.lockMinutes * 60000);
          user.failedLoginCount = 0;
          audit(req, "account_locked", { user: user.toPublic(), success: false, details: { minutes: config.lockMinutes } });
        }
        await user.save();
      }
      audit(req, "login_failed", {
        user: user ? user.toPublic() : null,
        username,
        success: false,
        details: { reason: !user ? "unknown_user" : !passwordOk ? "wrong_password" : "inactive" },
      });
      return res.status(401).json({ error: "Wrong username or password.", code: "BAD_CREDENTIALS" });
    }

    user.failedLoginCount = 0;
    user.lockUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    const session = await auth.startSession(req, res, user);
    audit(req, "login_success", { user: user.toPublic(), details: { sessionId: String(session._id) } });
    res.json({ user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/refresh ----------
router.post("/refresh", refreshLimiter, dbGuard, async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies[auth.REFRESH_COOKIE];
    if (!token) return res.status(401).json({ error: "Please sign in.", code: "NO_TOKEN" });

    let payload;
    try {
      payload = auth.verifyRefresh(token);
    } catch {
      auth.clearAuthCookies(res);
      return res.status(401).json({ error: "Session expired. Please sign in again.", code: "REFRESH_INVALID" });
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      auth.clearAuthCookies(res);
      return res.status(401).json({ error: "Account disabled.", code: "USER_INACTIVE" });
    }

    const result = await auth.rotateSession(req, res, payload, user);
    if (result.error) {
      auth.clearAuthCookies(res);
      if (result.reuse) audit(req, "token_reuse_detected", { user: user.toPublic(), success: false, details: { sessionId: payload.sid } });
      return res.status(401).json({ error: "Session ended. Please sign in again.", code: "SESSION_ENDED" });
    }
    audit(req, "token_refreshed", { user: user.toPublic(), details: { sessionId: payload.sid } });
    res.json({ user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/logout ----------
router.post("/logout", async (req, res) => {
  let sid = null;
  let who = null;
  for (const [name, verify] of [[auth.ACCESS_COOKIE, auth.verifyAccess], [auth.REFRESH_COOKIE, auth.verifyRefresh]]) {
    const t = req.cookies && req.cookies[name];
    if (!t || sid) continue;
    try {
      const p = verify(t);
      sid = p.sid;
      who = { id: p.sub, username: p.username, role: p.role };
    } catch { /* expired or invalid: just clear cookies */ }
  }
  if (sid && isDbReady()) {
    await auth.revokeSession(sid, "logout").catch(() => {});
    if (!who.username) {
      const u = await User.findById(who.id).lean().catch(() => null);
      if (u) who = { id: String(u._id), username: u.username, role: u.role };
    }
    audit(req, "logout", { user: who, details: { sessionId: sid } });
  }
  auth.clearAuthCookies(res);
  res.json({ ok: true });
});

// ---------- GET /api/auth/me ----------  (called once when the dashboard opens)
router.get("/me", requireAuth, (req, res) => {
  require("../lib/clientIp").logIpHeaders(req);
  audit(req, "dashboard_opened");
  res.set("Cache-Control", "no-store");
  res.json({ user: req.user });
});

module.exports = router;
