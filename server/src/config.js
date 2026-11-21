const path = require("path");
// ENV_FILE lets a command use another settings file, e.g. ENV_FILE=.env.atlas to manage users in Atlas.
const envFile = process.env.ENV_FILE ? path.resolve(__dirname, "..", process.env.ENV_FILE) : path.join(__dirname, "..", ".env");
require("dotenv").config({ path: envFile, quiet: true });

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const list = (v, fallback) => String(v || fallback).split(",").map((s) => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);

const config = {
  port: num(process.env.PORT, 5000),
  isProduction: process.env.NODE_ENV === "production",
  mongoUri: (process.env.MONGODB_URI || "").trim(),
  // Database name; overrides any name inside MONGODB_URI.
  mongoDbName: (process.env.MONGODB_DB_NAME || "").trim(),

  // ---- Live updates (Socket.IO) ----
  realtime: {
    enabled: process.env.REALTIME_ENABLED !== "false",
    // URL path of the live connection on the API server.
    path: "/" + (process.env.REALTIME_PATH || "/socket.io").replace(/^\/+|\/+$/g, ""),
    // Address browsers connect to. Empty = the website's own address (local / single server).
    // Behind Vercel it must be the API server itself (Vercel can't forward live connections),
    // e.g. https://your-api.onrender.com
    publicUrl: (process.env.REALTIME_PUBLIC_URL || "").trim().replace(/\/+$/, ""),
    // How long a connection ticket is valid (seconds).
    ticketSeconds: num(process.env.REALTIME_TICKET_SECONDS, 60) || 60,
    // Keep-alive ping (seconds); also how fast a dropped connection is noticed.
    pingIntervalSeconds: num(process.env.REALTIME_PING_SECONDS, 25) || 25,
  },
  // ---- Keep-alive (Render free plan sleeps after 15 min without requests) ----
  keepAlive: {
    enabled: process.env.KEEP_ALIVE_ENABLED !== "false",
    // This server's public address. Render sets RENDER_EXTERNAL_URL itself; empty = off (local).
    baseUrl: (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, ""),
    // Must stay below Render's 15 minutes.
    intervalMinutes: Math.min(num(process.env.KEEP_ALIVE_MINUTES, 10), 14),
    timeoutSeconds: 30,
  },
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
  // Google sign-in: the OAuth "Web application" Client ID from Google Cloud (not a secret).
  googleClientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
  // Local testing without Google: DEV_LOGIN=true shows "sign in as <Gmail>" on the sign-in page.
  // Never available when NODE_ENV=production.
  devLogin: process.env.NODE_ENV !== "production" && process.env.DEV_LOGIN === "true",
  // Number of proxies in front of the app in production:
  // Vercel -> Cloudflare -> Render edge -> Render internal = 4.
  trustProxyHops: process.env.TRUST_PROXY_HOPS
    ? num(process.env.TRUST_PROXY_HOPS, 1)
    : process.env.NODE_ENV === "production" ? 4 : 0,

  auditRetentionDays: num(process.env.AUDIT_RETENTION_DAYS, 365),

  // ---- Assistant (chat) ----
  // Free Groq key (console.groq.com). It only reads the wording of questions; answers come from the
  // database. Without a key, a simpler built-in reader is used.
  groqApiKey: (process.env.GROQ_API_KEY || "").trim(),
  groqModel: (process.env.GROQ_MODEL || "openai/gpt-oss-120b").trim(),
  // Tried in this order when a model's free allowance is used up (Groq counts each model separately).
  groqFallbackModels: (process.env.GROQ_FALLBACK_MODELS || "openai/gpt-oss-20b,qwen/qwen3.8-27b")
    .split(",").map((s) => s.trim()).filter(Boolean),

  // ---- Stats images (ImageKit, imagekit.io) ----
  // Files are private; the server hands signed links that expire. The URL endpoint is optional
  // (it is read from each upload's answer), but a full "https://ik.imagekit.io/<id>" is used for the CSP.
  imagekit: {
    privateKey: (process.env.IMAGEKIT_PRIVATE_KEY || "").trim(),
    publicKey: (process.env.IMAGEKIT_PUBLIC_KEY || "").trim(),
    urlEndpoint: (process.env.IMAGEKIT_URL_ENDPOINT || "").trim().replace(/\/+$/, ""),
    folder: (process.env.IMAGEKIT_FOLDER || "/umoor-sehhat/stats").trim(),
  },

  // ---- Forms (built by the Super Admin, filled by Jamaat Coordinators) ----
  forms: {
    // Signs the personal links (the Gmail inside a link can't be changed). Empty = derived from
    // JWT_ACCESS_SECRET (so changing that also invalidates old personal links).
    linkSecret: (process.env.FORMS_LINK_SECRET || "").trim(),
    // Website address used to build form links, e.g. https://your-site.vercel.app (empty = the first CORS_ORIGIN).
    publicUrl: (process.env.FORMS_PUBLIC_URL || "").trim().replace(/\/+$/, ""),
    folder: (process.env.IMAGEKIT_FORMS_FOLDER || "/umoor-sehhat/forms").trim(),
    // Upper limits for uploads (the Super Admin can set lower limits on each field, never higher).
    // The server holds each upload in memory while sending it to ImageKit: keep these modest on small servers.
    maxMb: {
      image: num(process.env.FORMS_MAX_IMAGE_MB, 10) || 10,
      video: num(process.env.FORMS_MAX_VIDEO_MB, 50) || 50,
      file: num(process.env.FORMS_MAX_FILE_MB, 10) || 10,
    },
    // Extensions that may be allowed at all (the Super Admin picks from these per field).
    extensions: {
      image: list(process.env.FORMS_IMAGE_EXTENSIONS, "jpg,jpeg,png,webp,gif,heic"),
      video: list(process.env.FORMS_VIDEO_EXTENSIONS, "mp4,mov,webm,m4v,3gp"),
      file: list(process.env.FORMS_FILE_EXTENSIONS, "pdf,doc,docx,xls,xlsx,csv,ppt,pptx,txt"),
    },
  },
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

module.exports = config;
