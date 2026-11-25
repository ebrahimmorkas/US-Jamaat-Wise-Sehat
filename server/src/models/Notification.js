// A message shown in a Jamaat Coordinator's portal (Notifications). Reminders sent by email (part C) are also
// saved here, so the same message appears in the portal.
const { mongoose } = require("../db");

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["reminder", "form", "info"], default: "info" },
    title: { type: String, trim: true, maxlength: 200, required: true },
    body: { type: String, trim: true, maxlength: 5000, default: "" },
    form: { type: mongoose.Schema.Types.ObjectId, ref: "Form", default: null }, // the form it is about (if any)
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
