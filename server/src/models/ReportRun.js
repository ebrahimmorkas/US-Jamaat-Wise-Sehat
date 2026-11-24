// A report someone generated (listed on the Generate page so the same report can be made again).
// The PDF itself is kept only for a few hours (routes/reports.js); this record stays.
const { mongoose } = require("../db");

const reportRunSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    by: { type: new mongoose.Schema({ email: String, name: String, role: String }, { _id: false }) },
    form: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true },
    formTitle: String,
    format: { type: mongoose.Schema.Types.ObjectId, ref: "ReportFormat", required: true },
    formatName: String,
    name: { type: String, default: "" }, // the file name typed on the Generate page ("" = the default)
    fileName: String,                    // the report's file name as downloaded
    jobId: String,                       // the files can be downloaded while this job is kept
    pages: Number,
    jamaats: Number,
    photos: Number,
  },
  { timestamps: true }
);
reportRunSchema.index({ owner: 1, createdAt: -1 });
reportRunSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ReportRun", reportRunSchema);
