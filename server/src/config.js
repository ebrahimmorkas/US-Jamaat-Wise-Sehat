const path = require("path");
// ENV_FILE lets a command use another settings file, e.g. ENV_FILE=.env.atlas to manage users in Atlas.
const envFile = process.env.ENV_FILE ? path.resolve(__dirname, "..", process.env.ENV_FILE) : path.join(__dirname, "..", ".env");
require("dotenv").config({ path: envFile, quiet: true });

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const config = {
  port: num(process.env.PORT, 5000),
  isProduction: process.env.NODE_ENV === "production",
  mongoUri: (process.env.MONGODB_URI || "").trim(),
  // Database name; overrides any name inside MONGODB_URI.
  mongoDbName: (process.env.MONGODB_DB_NAME || "").trim(),

  sheetId: process.env.SHEET_ID || "",
  sheetAccess: (process.env.SHEET_ACCESS || "public").toLowerCase(),
  serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
    ? path.resolve(__dirname, "..", process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE)
    : "",
  serviceAccountKeyJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON || "",

  syncIntervalSeconds: num(process.env.SYNC_INTERVAL_SECONDS, 120),
  manualRefreshCooldownSeconds: num(process.env.MANUAL_REFRESH_COOLDOWN_SECONDS, 15),
  // Website address(es) allowed to call the API, comma-separated
  // (e.g. "https://your-site.vercel.app,https://a.com").
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),

  clientDist: path.join(__dirname, "..", "..", "client", "dist"),

  // ---- Authentication ----
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
  accessTokenDays: num(process.env.ACCESS_TOKEN_DAYS, 7),
  refreshTokenDays: num(process.env.REFRESH_TOKEN_DAYS, 30),
  maxFailedLogins: num(process.env.MAX_FAILED_LOGINS, 5),
  lockMinutes: num(process.env.LOCK_MINUTES, 15),
  // Number of proxies in front of the app (Vercel -> Cloudflare -> Render = 3 in production).
  trustProxyHops: process.env.TRUST_PROXY_HOPS
    ? num(process.env.TRUST_PROXY_HOPS, 1)
    : process.env.NODE_ENV === "production" ? 3 : 0,

  auditRetentionDays: num(process.env.AUDIT_RETENTION_DAYS, 365),
};

// JWT secrets: required in production; a temporary random one is used in development.
for (const key of ["jwtAccessSecret", "jwtRefreshSecret"]) {
  if (!config[key]) {
    if (config.isProduction) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production.");
    }
    config[key] = require("crypto").randomBytes(48).toString("hex");
    console.warn(`[auth] ${key === "jwtAccessSecret" ? "JWT_ACCESS_SECRET" : "JWT_REFRESH_SECRET"} not set: using a temporary one (logins reset on restart).`);
  }
}
if (config.jwtAccessSecret === config.jwtRefreshSecret) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.");
}

if (!config.sheetId) {
  throw new Error("SHEET_ID is missing. Copy server/.env.example to server/.env and set it.");
}
if (!["public", "service-account"].includes(config.sheetAccess)) {
  throw new Error('SHEET_ACCESS must be "public" or "service-account".');
}

module.exports = config;
