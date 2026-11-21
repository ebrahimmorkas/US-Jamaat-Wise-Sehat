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
  "comments_viewed",      // opened the JC comments (Sahebo dashboard or JC dashboard)
  "entry_viewed",         // a JC opened a Jamaat's monthly form
  "audit_viewed",
  "logs_deleted",
  "chat_asked",           // a question to the assistant (the question and how it was read; not the answer)
  "data_viewed",          // a JC opened the Data tab
  "data_downloaded",      // the Data tab's Excel was downloaded
  "data_uploaded",        // the Super Admin uploaded a new Data Excel file
  "data_cleared",         // the Super Admin removed the uploaded data
  "data_changed",         // a JC changed a dropdown cell on the Data tab
  "data_choices_changed", // the Super Admin changed the Data dropdown choices
  "metric_added",         // a JC added a metric (permanent work they handle)
  "metric_updated",       // a JC changed a metric
  "metric_deleted",       // a JC removed a metric
  "stats_uploaded",       // the Super Admin uploaded a Stats image
  "stats_deleted",        // the Super Admin removed a Stats image
  "jc_rated",             // the Super Admin set / changed / cleared a JC's star rating
  "form_created",         // the Super Admin created a form
  "form_updated",         // ... changed its settings / questions / top image
  "form_status_changed",  // Draft / Testing / Published / Closed
  "form_deleted",         // status "D" (kept, restorable)
  "form_restored",
  "form_links_downloaded",// the Excel of personal links
  "form_test_cleared",    // responses filled while testing were removed
  "form_submitted",       // someone filled a form
  "form_responses_exported", // downloaded a form's responses (Excel)
  "form_announced", // emailed the form link to every Jamaat Coordinator
  "email_sent",           // "Send email": an email sent / scheduled (or sent again to those it failed for)
  "email_cancelled",      // ... a scheduled email cancelled
  "email_settings_changed", // the email provider switched (Nodemailer / SendGrid)
  "email_template_saved",   // an email template added / changed
  "email_template_deleted",
  "email_template_restored",
  "reminder_sent", // "Send reminder" on a form's Jamaat status page
  "email_file_published",   // an image / document put inside an email (public link)
  "form_response_edited", // ... and changed their response
  // data changes (audit trail)
  "user_created",
  "user_updated",
  "user_deleted",         // deletes only set status "D" (the record is kept)
  "user_restored",        // ... and can be restored (status back to "A")
  "user_password_reset",
  "dropdown_updated",     // a Mauze Type value was added / renamed / removed (status D) / restored / reordered
  "field_created",        // a JC portal question was added
  "field_updated",        // ... renamed, its answers changed, reordered, (de)activated
  "field_deleted",
  "field_restored",
  "entry_submitted",      // a JC saved a Jamaat's monthly form
  "master_created",       // Jamiat / Jamaat added
  "master_updated",
  "master_deleted",
  "master_restored",
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
