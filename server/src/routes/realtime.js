const express = require("express");
const config = require("../config");
const { requireAuth } = require("../middleware/auth");
const { signSocketTicket } = require("../services/auth");

const router = express.Router();

// ---------- POST /api/realtime/ticket ----------
// A short-lived ticket the website sends when it opens (or re-opens) its live connection.
router.post("/ticket", requireAuth, (req, res) => {
  if (!config.realtime.enabled) return res.status(404).json({ error: "Live updates are turned off." });
  res.set("Cache-Control", "no-store");
  res.json({ ticket: signSocketTicket(req.user, req.sessionId), expiresIn: config.realtime.ticketSeconds });
});

module.exports = router;
