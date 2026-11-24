// A Jamaat's description in a form's report, typed by Media (Arabic): printed in the format's "Description" box.
const { mongoose } = require("../db");

const reportNoteSchema = new mongoose.Schema(
  {
    form: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true },
    jamaat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamaat", required: true },
    text: { type: String, default: "" },
    by: { type: new mongoose.Schema({ email: String, name: String, role: String }, { _id: false }) },
  },
  { timestamps: true }
);
reportNoteSchema.index({ form: 1, jamaat: 1 }, { unique: true });

module.exports = mongoose.model("ReportNote", reportNoteSchema);
