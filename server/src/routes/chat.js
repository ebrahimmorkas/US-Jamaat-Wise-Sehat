// The assistant: POST /api/chat { message, history } for every signed-in role.
// What each person can see is decided in services/chat/engine.js from their role and assignment.
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const config = require("../config");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { readQuestion, cleanHistory } = require("../services/chat/intent");
const { runIntent } = require("../services/chat/engine");

const router = express.Router();

// Per person (the free AI has a daily limit shared by everyone).
const askLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: (req) => `chat:${req.user.id}`,
  message: { error: "You've asked a lot of questions in a short time. Please wait a few minutes and try again." },
});

// Jamaat Coordinators only fill forms: no assistant.
const chatRoles = requireRole("saheb", "superadmin", "jc");

router.get("/status", requireAuth, chatRoles, (req, res) => {
  res.json({ ai: !!config.groqApiKey });
});

router.post("/", requireAuth, chatRoles, askLimiter, async (req, res, next) => {
  try {
    if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message.replace(/\s+/g, " ").trim() : "";
    if (!message) return res.status(400).json({ error: "Type a question." });
    if (message.length > 500) return res.status(400).json({ error: "Please keep the question under 500 characters." });
    const history = cleanHistory(body.history);

    const { intent, source, aiError } = await readQuestion(req.user, message, history);
    const blocks = await runIntent(req.user, intent);
    if (aiError === "busy" && intent.intent === "unclear") {
      blocks.unshift({ type: "text", text: "The AI helper is busy right now (free daily limit), so I read your question with the simpler built-in reader." });
    }
    audit(req, "chat_asked", { details: { question: message.slice(0, 300), intent: intent.intent, read: source } });
    res.set("Cache-Control", "no-store");
    res.json({ blocks, intent, source });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
