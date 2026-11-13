const express = require("express");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { activeMasters, dashboardData } = require("../services/data");
const { dashboardMetrics } = require("../services/fields");
const { commentsFor } = require("../services/comments");
const { currentMonth, isMonth } = require("../lib/month");

const router = express.Router();
const sahebOnly = [requireAuth, requireRole("saheb")];

// What the React app needs to draw the dashboard: one card per portal field marked
// "show on dashboard", each with its own answers, colours and "done" answers.
const publicConfig = async (month) => ({
  metrics: await dashboardMetrics(month), // one card per activity for monthly-activity questions
  showRemarks: form.showRemarks,
});

async function payload(req) {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  const [cfg, data] = await Promise.all([publicConfig(month), dashboardData(month)]);
  return { config: cfg, data };
}

const needDb = (req, res, next) =>
  isDbReady() ? next() : res.status(503).json({ error: "Database is starting, please try again in a moment." });

// GET /api/dashboard?month=YYYY-MM  (defaults to the current month)
router.get("/dashboard", ...sahebOnly, needDb, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await payload(req));
  } catch (err) {
    next(err);
  }
});

// "Refresh" button: same data, but logged in the audit trail.
router.post("/refresh", ...sahebOnly, needDb, async (req, res, next) => {
  try {
    const body = await payload(req);
    audit(req, "data_refresh", { details: { month: body.data.month } });
    res.set("Cache-Control", "no-store");
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/comments?month=YYYY-MM  the comments JCs typed (all active Jamaats).
// Loaded only when the Saheb opens "Comments"; each opening is logged.
router.get("/dashboard/comments", ...sahebOnly, needDb, async (req, res, next) => {
  try {
    const month = isMonth(req.query.month) ? req.query.month : currentMonth();
    const places = (await activeMasters()).flatMap((j) =>
      j.jamaats.map((jm) => ({ id: jm._id, name: jm.name, jamiatId: j._id, jamiat: j.name })));
    const body = await commentsFor(month, places);
    audit(req, "comments_viewed", { details: { month, count: body.comments.length } });
    res.set("Cache-Control", "no-store");
    res.json(body);
  } catch (err) {
    next(err);
  }
});

router.get("/health", (req, res) => {
  const ok = isDbReady();
  res.json({ ok, mongo: ok ? "connected" : "not connected" });
});

module.exports = router;
