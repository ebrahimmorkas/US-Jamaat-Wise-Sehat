// The photos Media chose for a Jamaat's place in a form's report (in this order).
// No pick = the first photos the Jamaat uploaded (as many as the form's "photos per Jamaat").
const { mongoose } = require("../db");

const reportPickSchema = new mongoose.Schema(
  {
    form: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true },
    jamaat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamaat", required: true },
    uploads: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    by: { type: new mongoose.Schema({ email: String, name: String, role: String }, { _id: false }) },
  },
  { timestamps: true }
);
reportPickSchema.index({ form: 1, jamaat: 1 }, { unique: true });

module.exports = mongoose.model("ReportPick", reportPickSchema);
