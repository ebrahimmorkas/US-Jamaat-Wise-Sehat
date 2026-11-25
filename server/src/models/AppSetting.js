// Small settings the Super Admin changes in the portal (e.g. which email provider sends).
// Secrets (passwords, API keys) are never stored here: they stay in the server settings (.env / Render).
const { mongoose } = require("../db");

const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
    updatedBy: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppSetting", appSettingSchema);
