const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const apiRoutes = require("./routes/api");

const app = express();
app.set("trust proxy", 1); // correct client IPs behind a hosting proxy (rate limiting)
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
if (!config.isProduction) app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "10kb" }));

app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/api", apiRoutes);
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// In production the built React app is served from the same server.
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
