const express = require("express");
const AuditLog = require("../models/AuditLog");
const { ACTIONS } = require("../models/AuditLog");
const { audit } = require("../services/audit");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Events the website itself reports (everything else is logged by the server).
const CLIENT_EVENTS = new Set(["list_viewed"]);
const clean = (v) => (v == null ? undefined : String(v).slice(0, 120));

// ---------- POST /api/audit/event ----------
router.post("/event", requireAuth, requireRole("saheb"), (req, res) => {
  const { action, details = {} } = req.body || {};
  if (!CLIENT_EVENTS.has(action)) return res.status(400).json({ error: "Unknown event." });
  audit(req, action, {
    details: {
      metric: clean(details.metric),
      status: clean(details.status),
      jamiat: clean(details.jamiat),
      jamaat: clean(details.jamaat),
      count: Number.isFinite(details.count) ? details.count : undefined,
    },
  });
  res.status(204).end();
});

// ---------- GET /api/audit ----------  (Super Admin only)
// ?limit=50 (max 200) &before=<ISO date> &action=login_failed &username=sehhat
router.get("/", requireAuth, requireRole("superadmin"), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const filter = {};
    if (req.query.action && ACTIONS.includes(req.query.action)) filter.action = req.query.action;
    if (req.query.username) filter.username = String(req.query.username).toLowerCase().slice(0, 64);
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (!Number.isNaN(d.getTime())) filter.at = { $lt: d };
    }
    const items = await AuditLog.find(filter).sort({ at: -1 }).limit(limit).select("-__v -user").lean();
    audit(req, "audit_viewed", { details: { filter: { ...filter, at: undefined }, count: items.length } });
    res.set("Cache-Control", "no-store");
    res.json({ items, next: items.length === limit ? items[items.length - 1].at : null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
