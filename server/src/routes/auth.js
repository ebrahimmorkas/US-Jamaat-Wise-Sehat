const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const config = require("../config");
const { isDbReady } = require("../db");
const User = require("../models/User");
const { parseGmail } = require("../lib/gmail");
const { verifyGoogleCredential } = require("../lib/google");
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

// ---------- GET /api/auth/config ----------  what the sign-in page needs
router.get("/config", (req, res) => {
  res.json({ googleClientId: config.googleClientId, devLogin: config.devLogin });
});

// Signs in the user registered with this Gmail (any role). Only Gmails added by a Super Admin get in.
async function signIn(req, res, { email, sub, name, method }) {
  const g = parseGmail(email);
  const user = g.error ? null : await User.findOne({ emailKey: g.emailKey }).select("+googleSub");

  const refuse = (reason, message, code) => {
    audit(req, "login_failed", { user: user ? user.toPublic() : null, username: email, success: false, details: { reason, method } });
    return res.status(403).json({ error: message, code });
  };
  if (!user) {
    return refuse("not_registered", `${email} is not registered. Ask the Super Admin to add this Google account.`, "NOT_REGISTERED");
  }
  if (!user.isActive) return refuse("inactive", "This account has been deactivated. Contact the Super Admin.", "USER_INACTIVE");
  // The Gmail address was given to someone else's Google account? (Google ids never change.)
  if (sub && user.googleSub && user.googleSub !== sub) return refuse("google_account_mismatch", "This Google account does not match the registered one. Contact the Super Admin.", "ACCOUNT_MISMATCH");

  if (sub && !user.googleSub) user.googleSub = sub;
  if (name) user.name = name.slice(0, 120);
  user.lastLoginAt = new Date();
  await user.save();

  const session = await auth.startSession(req, res, user);
  audit(req, "login_success", { user: user.toPublic(), details: { sessionId: String(session._id), method } });
  res.json({ user: user.toPublic() });
}

// ---------- POST /api/auth/google  { credential } ----------  "Sign in with Google"
router.post("/google", loginLimiter, dbGuard, async (req, res, next) => {
  try {
    let google;
    try {
      google = await verifyGoogleCredential((req.body || {}).credential);
    } catch (err) {
      audit(req, "login_failed", { success: false, details: { reason: "google_verify_failed", method: "google" } });
      return res.status(err.status || 401).json({ error: err.message, code: "GOOGLE_INVALID" });
    }
    await signIn(req, res, { ...google, method: "google" });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/auth/dev-login  { email } ----------  local testing only (DEV_LOGIN=true, never in production)
router.post("/dev-login", loginLimiter, dbGuard, async (req, res, next) => {
  try {
    if (!config.devLogin) return res.status(404).json({ error: "Not found" });
    const email = String((req.body || {}).email || "").trim().toLowerCase().slice(0, 120);
    await signIn(req, res, { email, method: "dev" });
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
    if (!user || !user.isActive || !user.email) {
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
      if (u) who = { id: String(u._id), username: u.email || u.username, role: u.role };
    }
    audit(req, "logout", { user: who, details: { sessionId: sid } });
  }
  auth.clearAuthCookies(res);
  res.json({ ok: true });
});

// ---------- GET /api/auth/me ----------  (called once when the website opens)
router.get("/me", requireAuth, (req, res) => {
  audit(req, { superadmin: "admin_opened", jc: "portal_opened" }[req.user.role] || "dashboard_opened");
  res.set("Cache-Control", "no-store");
  res.json({ user: req.user });
});

module.exports = router;
