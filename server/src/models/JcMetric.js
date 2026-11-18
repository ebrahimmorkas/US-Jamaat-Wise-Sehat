// "Metrics" on the JC Portal: the permanent work a JC handles besides their Jamaats (e.g. "IT department").
// One document per metric (free text). JCs add / edit / delete their own; Saheb and Super Admin read them.
const { mongoose } = require("../db");

const jcMetricSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JcMetric", jcMetricSchema);
