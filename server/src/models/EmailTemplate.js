// A reusable email: subject, formatted body (with {{variables}}), CC / BCC, attachments.
// Used in "Send email" now and by reminders later. Delete = status "D" (kept, restorable).
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const fileSchema = new mongoose.Schema(
  { fileId: String, filePath: String, url: String, endpoint: String, name: String, size: Number, type: String },
  { _id: false }
);

const emailTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    html: { type: String, required: true }, // cleaned (only safe formatting), {{variables}} kept
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    greeting: { type: Boolean, default: true }, // start with "Salaam (name),"
    files: { type: [fileSchema], default: [] },
    createdBy: String,
    updatedBy: String,
    ...softDeleteFields(),
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmailTemplate", emailTemplateSchema);
