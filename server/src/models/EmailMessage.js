// An email written in "Send email" (Super Admin / Saheb): sent now or at a set time, to portal users.
// Each recipient's result is kept (sent / failed, by which provider) — this is the "Sent" history.
const { mongoose } = require("../db");

const fileSchema = new mongoose.Schema(
  { fileId: String, filePath: String, url: String, endpoint: String, name: String, size: Number, type: String },
  { _id: false }
);
const personSchema = new mongoose.Schema(
  { user: mongoose.Schema.Types.ObjectId, email: String, name: String, role: String },
  { _id: false }
);
const recipientSchema = new mongoose.Schema(
  {
    user: mongoose.Schema.Types.ObjectId, email: String, name: String, role: String, place: String,
    status: { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
    provider: String, fellBack: Boolean, error: String, sentAt: Date,
  },
  { _id: false }
);

const emailMessageSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    html: { type: String, required: true }, // cleaned (only safe formatting)
    text: { type: String, default: "" },
    audience: { type: String, default: "" }, // who it was for, in words ("All Jamaat Coordinators of AHMEDABAD, + 2 people")
    files: { type: [fileSchema], default: [] },
    recipients: { type: [recipientSchema], default: [] },
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    status: { type: String, enum: ["scheduled", "sending", "done", "failed", "cancelled"], default: "scheduled", index: true },
    sendAt: { type: Date, required: true, index: true },
    startedAt: Date,
    finishedAt: Date,
    lockedUntil: Date, // the sender working on it (another server never sends it twice)
    createdBy: personSchema,
    cancelledBy: personSchema,
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmailMessage", emailMessageSchema);
