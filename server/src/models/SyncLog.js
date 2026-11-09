const { mongoose } = require("../db");

// One entry per sync attempt — handy to see when/why a sync failed. Kept for 30 days.
const syncLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  trigger: { type: String, enum: ["startup", "schedule", "manual", "cli"], required: true },
  ok: Boolean,
  durationMs: Number,
  jamiatCount: Number,
  jamaatCount: Number,
  failedSheets: [String],
  error: String,
});

module.exports = mongoose.model("SyncLog", syncLogSchema);
