const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const config = require("../config");
const dash = require("../dashboardConfig");
const sync = require("../services/sync");
const { isDbReady } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { clientIp } = require("../lib/clientIp");

const router = express.Router();

// What the React app needs to draw the dashboard (sheet layout details stay on the server).
const publicConfig = () => ({
  metrics: dash.metrics.map(({ key, label, group, statuses }) => ({ key, label, group, statuses })),
  statusSets: dash.statusSets,
  statusTones: dash.statusTones,
  doneStatuses: dash.doneStatuses,
  defaultStatus: dash.defaultStatus,
  showRemarks: dash.showRemarks,
  refreshIntervalSeconds: config.syncIntervalSeconds,
});

function payload() {
  const snap = sync.getCurrent();
  const status = sync.getStatus();
  return {
    config: publicConfig(),
    data: {
      month: snap.month,
      jamiats: snap.jamiats,
      failedSheets: snap.failed.map((f) => f.sheet),
      syncedAt: snap.syncedAt,
    },
    sync: { nextSyncAt: status.nextSyncAt, lastError: status.lastError },
  };
}

router.get("/dashboard", requireAuth, (req, res) => {
  if (!sync.getCurrent()) {
    const { lastError } = sync.getStatus();
    return res.status(503).json({ error: lastError || "Data is still loading, try again in a few seconds." });
  }
  res.set("Cache-Control", "no-store");
  res.json(payload());
});

// "Refresh" button: re-read the sheet now (with a cooldown so the Google quota is safe).
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
});
router.post("/refresh", requireAuth, refreshLimiter, async (req, res) => {
  const { lastAttemptAt } = sync.getStatus();
  const cooledDown = Date.now() - lastAttemptAt >= config.manualRefreshCooldownSeconds * 1000;
  try {
    if (cooledDown || !sync.getCurrent()) await sync.syncNow("manual");
    audit(req, "data_refresh", { details: { synced: cooledDown, syncedAt: sync.getCurrent()?.syncedAt } });
    res.set("Cache-Control", "no-store");
    res.json({ ...payload(), refreshed: cooledDown });
  } catch (err) {
    audit(req, "data_refresh", { success: false, details: { error: err.message } });
    if (sync.getCurrent()) return res.json({ ...payload(), refreshed: false, warning: err.message });
    res.status(502).json({ error: err.message });
  }
});

router.get("/health", (req, res) => {
  const snap = sync.getCurrent();
  const status = sync.getStatus();
  res.json({
    ok: !!snap,
    mongo: isDbReady() ? "connected" : "not connected",
    sheetAccess: config.sheetAccess,
    syncedAt: snap ? snap.syncedAt : null,
    lastError: status.lastError,
  });
});

module.exports = router;
