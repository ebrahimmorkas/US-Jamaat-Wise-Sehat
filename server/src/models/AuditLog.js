const { mongoose } = require("../db");
const config = require("../config");

const ACTIONS = [
  "login_success",
  "login_failed",
  "login_blocked",        // tried while the account was locked
  "account_locked",
  "logout",
  "token_refreshed",
  "token_reuse_detected", // an old refresh token was used again -> session ended
  "dashboard_opened",
  "data_refresh",         // clicked the Refresh button
  "list_viewed",          // opened a list of Jamaats from a card
  "audit_viewed",
  "user_created",
  "user_password_reset",
];

const auditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * config.auditRetentionDays },
  action: { type: String, enum: ACTIONS, required: true, index: true },
  success: { type: Boolean, default: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  username: { type: String, index: true },
  role: String,
  ip: String,
  userAgent: String,
  details: { type: mongoose.Schema.Types.Mixed },
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
module.exports.ACTIONS = ACTIONS;
