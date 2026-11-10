const { mongoose } = require("../db");
const config = require("../config");

// Every action in the software. Data changes also carry `target` (what was changed) and
// `changes` (only the fields that changed, with their previous and new values).
const ACTIONS = [
  // sign-in & sessions
  "login_success",
  "login_failed",
  "login_blocked",
  "account_locked",
  "logout",
  "token_refreshed",
  "token_reuse_detected", // an old refresh token was used again -> session ended
  "access_denied",        // someone tried to open / call something their role can't use
  // pages opened
  "dashboard_opened",     // a Saheb opened the dashboard
  "admin_opened",         // a Super Admin opened the Super Admin portal
  "portal_opened",        // a JC opened the JC portal
  "data_refresh",         // clicked the Refresh button
  "list_viewed",          // opened a list of Jamaats from a card
  "entry_viewed",         // a JC opened a Jamaat's monthly form
  "audit_viewed",
  // data changes (audit trail)
  "user_created",
  "user_updated",
  "user_deleted",
  "user_password_reset",
  "dropdown_updated",     // a Mauze Type value was added / renamed / removed / reordered
  "field_created",        // a JC portal question was added
  "field_updated",        // ... renamed, its answers changed, reordered, (de)activated
  "field_deleted",
  "entry_submitted",      // a JC saved a Jamaat's monthly form
  "master_created",       // Jamiat / Jamaat added
  "master_updated",
  "master_deleted",
];

const changeSchema = new mongoose.Schema(
  {
    field: String,                          // e.g. "houseCount", "values.tibb"
    label: String,                          // e.g. "House Count", "Tibb"
    from: { type: mongoose.Schema.Types.Mixed },
    to: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const auditLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * config.auditRetentionDays },
  action: { type: String, enum: ACTIONS, required: true, index: true },
  success: { type: Boolean, default: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  username: { type: String, index: true },
  role: String,
  ip: String,
  userAgent: String,
  // What the action was about, e.g. { type: "jamaat", id, label: "DHANERA (AHMEDABAD)" }
  target: {
    type: { type: String },
    id: String,
    label: String,
  },
  changes: { type: [changeSchema], default: undefined },
  details: { type: mongoose.Schema.Types.Mixed },
});
auditLogSchema.index({ "target.type": 1, "target.id": 1, at: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
module.exports.ACTIONS = ACTIONS;
