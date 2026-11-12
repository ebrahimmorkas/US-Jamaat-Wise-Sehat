const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const config = require("./config");
const apiRoutes = require("./routes/api");
const authRoutes = require("./routes/auth");
const auditRoutes = require("./routes/audit");
const portalRoutes = require("./routes/portal");
const mastersRoutes = require("./routes/masters");
const usersRoutes = require("./routes/users");
const settingsRoutes = require("./routes/settings");
const fieldsRoutes = require("./routes/fields");
const { requireSameOrigin } = require("./middleware/auth");
const { clientIp } = require("./lib/clientIp");
const { logError } = require("./services/audit");
const { ACCESS_COOKIE, verifyAccess } = require("./services/auth");
const logsRoutes = require("./routes/logs");
const realtimeRoutes = require("./routes/realtime");
const { notifyOnSuccess } = require("./realtime");
const { TOPICS, EVENTS } = require("./realtime/topics");

// The live connection may go straight to the API server (REALTIME_PUBLIC_URL).
const realtimeOrigins = config.realtime.publicUrl
  ? [config.realtime.publicUrl, config.realtime.publicUrl.replace(/^http/, "ws")]
  : [];

const app = express();
app.set("trust proxy", config.trustProxyHops); // real visitor IP behind Vercel + Render
app.disable("x-powered-by");

app.use(
  helmet({
    // Google sign-in popups need to talk back to this page.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // accounts.google.com = the "Sign in with Google" button
        scriptSrc: ["'self'", "https://accounts.google.com/gsi/client"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com/gsi/style"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
        connectSrc: ["'self'", "https://accounts.google.com/gsi/", ...realtimeOrigins],
        frameSrc: ["https://accounts.google.com/gsi/"],
        frameAncestors: ["'none'"], // nobody may show this site inside a frame (clickjacking)
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
  })
);
app.use(compression());
app.use(cors({ origin: config.corsOrigins, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], credentials: true }));
app.use(express.json({ limit: "100kb" })); // a JC with "All" Jamaats sends ~470 ids
app.use(cookieParser());

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  })
);
app.use("/api", requireSameOrigin); // CSRF protection for POST requests
app.use("/api/auth", authRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/logs", logsRoutes);
app.use("/api/realtime", realtimeRoutes);
app.use("/api/portal", portalRoutes); // publishes its own live update (with the month)
// Super Admin changes that the dashboards show -> open Saheb and JC dashboards reload at once.
app.use("/api/masters",
  notifyOnSuccess(TOPICS.dashboard, EVENTS.dashboardChanged, { reason: "masters" }),
  notifyOnSuccess(TOPICS.portal, EVENTS.portalChanged, { reason: "masters" }), mastersRoutes);
app.use("/api/users", notifyOnSuccess(TOPICS.portal, EVENTS.portalChanged, { reason: "access" }), usersRoutes);
app.use("/api/settings", notifyOnSuccess(TOPICS.dashboard, EVENTS.dashboardChanged, { reason: "lists" }), settingsRoutes);
app.use("/api/fields",
  notifyOnSuccess(TOPICS.dashboard, EVENTS.dashboardChanged, { reason: "fields" }),
  notifyOnSuccess(TOPICS.portal, EVENTS.portalChanged, { reason: "fields" }), fieldsRoutes);
app.use("/api", apiRoutes);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// When the built React app exists next to the server, serve it too (single-server setup).
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
}

// Errors: bad requests (e.g. broken JSON, too large) get their own status; anything else is a
// server error -> saved in the error log, and the reference is sent so the Error page can show it.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode;
  if (status >= 400 && status < 500 && err.expose !== false) {
    return res.status(status).json({ error: status === 413 ? "The request is too large." : "The request could not be read.", code: "BAD_REQUEST" });
  }
  console.error("[http]", err);
  if (!req.user) {
    // Record who was signed in, even on routes that don't require sign-in.
    try {
      const p = verifyAccess(req.cookies && req.cookies[ACCESS_COOKIE]);
      req.user = { id: p.sub, username: p.username, role: p.role };
    } catch { /* not signed in */ }
  }
  const ref = logError({ req, message: err.message, stack: err.stack, status: 500 });
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong on the server.", code: "SERVER_ERROR", ref });
});

module.exports = app;
