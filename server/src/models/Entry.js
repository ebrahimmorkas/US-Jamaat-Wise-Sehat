// One JC submission: the answers for one Jamaat for one month.
// Submitting again for the same Jamaat + month updates the same entry.
// Allowed answers are checked by the API against the dropdown lists (they can change).
const { mongoose } = require("../db");
const form = require("../formConfig");

const valuesShape = {};
for (const f of form.fields) {
  valuesShape[f.key] = { type: String, required: true, trim: true, maxlength: 40 };
}

const entrySchema = new mongoose.Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/, index: true },
    jamaat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamaat", required: true },
    values: { type: new mongoose.Schema(valuesShape, { _id: false }), required: true },
    remarks: { type: String, trim: true, maxlength: form.remarksMaxLength, default: "" },
    submitCount: { type: Number, default: 1 },
    lastIp: String,
  },
  { timestamps: true }
);
entrySchema.index({ jamaat: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("Entry", entrySchema);
