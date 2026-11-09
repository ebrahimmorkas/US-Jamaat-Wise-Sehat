const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const config = {
  port: num(process.env.PORT, 5000),
  isProduction: process.env.NODE_ENV === "production",
  mongoUri: process.env.MONGODB_URI || "",

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
};

if (!config.sheetId) {
  throw new Error("SHEET_ID is missing. Copy server/.env.example to server/.env and set it.");
}
if (!["public", "service-account"].includes(config.sheetAccess)) {
  throw new Error('SHEET_ACCESS must be "public" or "service-account".');
}

module.exports = config;
