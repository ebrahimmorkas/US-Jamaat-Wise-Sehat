const express = require("express");
const config = require("../config");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { dashboardData } = require("../services/data");
const { isMonth } = require("../lib/month");

const router = express.Router();

// What the React app needs to draw the dashboard.
const publicConfig = () => ({
  metrics: form.fields
    .filter((f) => f.dashboard !== false)
    .map(({ key, label, group, statuses }) => ({ key, label, group, statuses })),
  statusSets: form.statusSets,
  statusTones: form.statusTones,
  doneStatuses: form.doneStatuses,
  defaultStatus: form.defaultStatus,
  showRemarks: form.showRemarks,
  refreshIntervalSeconds: config.refreshIntervalSeconds,
});

async function payload(req) {
  const month = isMonth(req.query.month) ? req.query.month : undefined;
  return { config: publicConfig(), data: await dashboardData(month) };
}

const needDb = (req, res, next) =>
  isDbReady() ? next() : res.status(503).json({ error: "Database is starting, please try again in a moment." });

// GET /api/dashboard?month=YYYY-MM  (defaults to the current month)
router.get("/dashboard", requireAuth, needDb, async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await payload(req));
  } catch (err) {
    next(err);
  }
});

// "Refresh" button: same data, but logged in the audit trail.
router.post("/refresh", requireAuth, needDb, async (req, res, next) => {
  try {
    const body = await payload(req);
    audit(req, "data_refresh", { details: { month: body.data.month } });
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
