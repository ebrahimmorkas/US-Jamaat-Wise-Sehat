// JWT access/refresh tokens, sessions and HttpOnly cookies (sign-in itself is done with Google).
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const Session = require("../models/Session");
const { clientIp } = require("../lib/clientIp");

const ISSUER = "us-sehhat-api";
const AUDIENCE = "us-sehhat-web";
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_GRACE_MS = 30 * 1000;

const ACCESS_COOKIE = "us_access";
const REFRESH_COOKIE = "us_refresh";

// ---------- tokens ----------
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const newJti = () => crypto.randomBytes(32).toString("hex");

function signAccess(user, sessionId) {
  return jwt.sign(
    { typ: "access", sid: String(sessionId), role: user.role, username: user.email || user.username },
    config.jwtAccessSecret,
    { subject: String(user._id || user.id), expiresIn: `${config.accessTokenDays}d`, issuer: ISSUER, audience: AUDIENCE, algorithm: "HS256" }
  );
}

function signRefresh(user, sessionId, jti) {
  return jwt.sign(
    { typ: "refresh", sid: String(sessionId), jti },
    config.jwtRefreshSecret,
    { subject: String(user._id || user.id), expiresIn: `${config.refreshTokenDays}d`, issuer: ISSUER, audience: AUDIENCE, algorithm: "HS256" }
  );
}

function verify(token, secret, typ) {
  const payload = jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
  if (payload.typ !== typ) throw new Error("Wrong token type");
  return payload;
}
const verifyAccess = (t) => verify(t, config.jwtAccessSecret, "access");
const verifyRefresh = (t) => verify(t, config.jwtRefreshSecret, "refresh");

// ---------- cookies ----------
const baseCookie = () => ({ httpOnly: true, secure: config.isProduction, sameSite: "lax" });

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(), path: "/api", maxAge: config.accessTokenDays * DAY_MS });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie(), path: "/api/auth", maxAge: config.refreshTokenDays * DAY_MS });
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(), path: "/api" });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: "/api/auth" });
}

// ---------- sessions ----------
async function startSession(req, res, user) {
  const jti = newJti();
  const session = await Session.create({
    user: user._id,
    jtiHash: sha256(jti),
    expiresAt: new Date(Date.now() + config.refreshTokenDays * DAY_MS),
    lastUsedAt: new Date(),
    ip: clientIp(req),
    userAgent: String(req.get("user-agent") || "").slice(0, 300),
  });
  setAuthCookies(res, signAccess(user, session._id), signRefresh(user, session._id, jti));
  return session;
}

// Swap a valid refresh token for a new access + refresh token pair (rotation).
// Returns { session } or { error, reuse }.
async function rotateSession(req, res, payload, user) {
  const session = await Session.findById(payload.sid);
  if (!session || session.revokedAt || session.expiresAt < new Date() || String(session.user) !== payload.sub) {
    return { error: "Session ended" };
  }
  const presented = sha256(payload.jti);
  const isCurrent = presented === session.jtiHash;
  const isRecentPrevious =
    presented === session.prevJtiHash && session.rotatedAt && Date.now() - session.rotatedAt.getTime() < REFRESH_GRACE_MS;

  if (!isCurrent && !isRecentPrevious) {
    // An old refresh token was replayed: assume it was stolen and end the session.
    session.revokedAt = new Date();
    session.revokeReason = "refresh_token_reuse";
    await session.save();
    return { error: "Session ended", reuse: true };
  }

  const jti = newJti();
  session.prevJtiHash = session.jtiHash;
  session.jtiHash = sha256(jti);
  session.rotatedAt = new Date();
  session.lastUsedAt = new Date();
  session.expiresAt = new Date(Date.now() + config.refreshTokenDays * DAY_MS);
  await session.save();
  setAuthCookies(res, signAccess(user, session._id), signRefresh(user, session._id, jti));
  return { session };
}

async function revokeSession(sessionId, reason) {
  if (!sessionId) return;
  await Session.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  verifyAccess,
  verifyRefresh,
  startSession,
  rotateSession,
  revokeSession,
  clearAuthCookies,
};
