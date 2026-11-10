// Logs coming from the website, and the error list for the Super Admin.
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { isDbReady } = require("../db");
const { requireAuth, optionalAuth, requireRole } = require("../middleware/auth");
const ErrorLog = require("../models/ErrorLog");
const { audit, logError } = require("../services/audit");
const { clientIp } = require("../lib/clientIp");

const router = express.Router();
const clip = (v, n) => (v == null ? undefined : String(v).slice(0, n));

// Browsers can't flood the log.
const reportLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  message: { error: "Too many reports." },
});

// ---------- POST /api/logs/client-error  { message, stack, page, kind } ----------
// A crash in the website. Anyone may report (also before sign-in); the user is attached when signed in.
router.post("/client-error", reportLimiter, optionalAuth, (req, res) => {
  const b = req.body || {};
  const ref = logError({
    req,
    source: "client",
    message: clip(b.message, 1000) || "Website error",
    stack: clip(b.stack, 6000),
    path: clip(b.page, 500),
    details: { kind: clip(b.kind, 40), status: Number.isFinite(b.status) ? b.status : undefined, serverRef: clip(b.serverRef, 20) },
  });
  res.status(201).json({ ref });
});

// ---------- POST /api/logs/access-denied  { page } ----------
// A signed-in user opened a page their role can't use (the website shows "Access denied").
router.post("/access-denied", reportLimiter, requireAuth, (req, res) => {
  audit(req, "access_denied", { success: false, details: { page: clip((req.body || {}).page, 300), source: "page" } });
  res.status(204).end();
});

// ---------- POST /api/logs/test-error ----------  local testing only (same rules as the test sign-in)
// Makes the server fail on purpose, to check the Error page and the error log.
router.post("/test-error", (req, res, next) => {
  const config = require("../config");
  const local = ["127.0.0.1", "::1"].includes(clientIp(req));
  if (!config.devLogin || !local) return res.status(404).json({ error: "Not found" });
  next(new Error("Test error (triggered on purpose from this computer)"));
});

// ---------- GET /api/logs/errors ----------  (Super Admin)
// ?source=server|client &q=<text in message/user/ref> &from=<date> &to=<date> &before=<date> &limit=50
router.get("/errors", requireAuth, requireRole("superadmin"), async (req, res, next) => {
  try {
    if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const filter = {};
    if (["server", "client"].includes(req.query.source)) filter.source = req.query.source;
    const at = {};
    for (const [k, op] of [["from", "$gte"], ["to", "$lte"], ["before", "$lt"]]) {
      if (typeof req.query[k] === "string") {
        const d = new Date(req.query[k]);
        if (!Number.isNaN(d.getTime())) at[op] = d;
      }
    }
    if (Object.keys(at).length) filter.at = at;
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      const q = req.query.q.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [{ message: { $regex: q, $options: "i" } }, { username: { $regex: q, $options: "i" } }, { ref: q.toUpperCase() }, { path: { $regex: q, $options: "i" } }];
    }
    const items = await ErrorLog.find(filter).sort({ at: -1 }).limit(limit).select("-__v -user").lean();
    res.set("Cache-Control", "no-store");
    res.json({ items, next: items.length === limit ? items[items.length - 1].at : null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
