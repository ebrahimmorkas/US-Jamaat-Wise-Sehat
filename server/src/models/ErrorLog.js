// Errors from the server and from the website (browser), kept for the Super Admin's "Logs" page.
const { mongoose } = require("../db");
const config = require("../config");

const errorLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * config.auditRetentionDays },
  ref: { type: String, index: true },              // short reference shown to the user on the Error page
  source: { type: String, enum: ["server", "client"], required: true, index: true },
  message: { type: String, maxlength: 1000 },
  stack: { type: String, maxlength: 6000 },
  method: String,
  path: { type: String, maxlength: 500 },          // API path (server) or page address (client)
  status: Number,
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  username: String,
  role: String,
  ip: String,
  userAgent: String,
  details: { type: mongoose.Schema.Types.Mixed },
});

module.exports = mongoose.model("ErrorLog", errorLogSchema);
