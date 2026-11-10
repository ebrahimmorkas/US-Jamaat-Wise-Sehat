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
  "dashboard_opened",     // a Saheb opened the dashboard
  "admin_opened",         // a Super Admin opened the Super Admin portal
  "portal_opened",        // a JC opened the JC portal
  "data_refresh",         // clicked the Refresh button
  "list_viewed",          // opened a list of Jamaats from a card
  "audit_viewed",
  "user_created",         // incl. JC Gmails added by the Super Admin
  "user_updated",
  "user_deleted",
  "user_password_reset",
  "dropdown_updated",     // a Mauze Type value was added / renamed / removed / reordered
  "field_created",        // a JC portal question was added
  "field_updated",        // ... renamed, its answers changed, reordered, (de)activated
  "field_deleted",
  "entry_submitted",      // a JC saved a Jamaat's monthly form on /jc-portal
  "master_created",       // Jamiat / Jamaat added
  "master_updated",
  "master_deleted",
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
