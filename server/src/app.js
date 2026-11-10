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

const app = express();
app.set("trust proxy", config.trustProxyHops); // real visitor IP behind Vercel + Render
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
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
app.use("/api/portal", portalRoutes);
app.use("/api/masters", mastersRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/fields", fieldsRoutes);
app.use("/api", apiRoutes);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// When the built React app exists next to the server, serve it too (single-server setup).
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[http]", err);
  res.status(500).json({ error: "Something went wrong" });
});

module.exports = app;
