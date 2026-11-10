// One JC submission: the answers for one Jamaat for one month.
// Submitting again for the same Jamaat + month updates the same entry.
// values = { <portal field key>: "<answer>" }. The questions are managed by the Super Admin,
// so the API checks the answers against the current portal fields.
const { mongoose } = require("../db");
const form = require("../formConfig");

const entrySchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
    jamaat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamaat", required: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    remarks: { type: String, trim: true, maxlength: form.remarksMaxLength, default: "" },
    submitCount: { type: Number, default: 1 },
    lastIp: String,
  },
  { timestamps: true, minimize: false }
);
entrySchema.index({ jamaat: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("Entry", entrySchema);
