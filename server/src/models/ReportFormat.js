// A report format: the one-page PDF the Super Admin uploads (borders, background, "Image" boxes, "Jamiat" /
// "Jamaat" words). `layout` = where the places are (services/reportPdf.analyze). Delete = status "D" (kept).
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const reportFormatSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    fileName: { type: String, default: "" },
    size: Number,
    file: { type: Buffer, required: true, select: false }, // the PDF itself
    layout: { type: mongoose.Schema.Types.Mixed, required: true },
    summary: { type: String, default: "" }, // e.g. "3 Jamaats on each page, 2 photos each, with the Jamiat name."
    photoW: { type: Number, min: 5, max: 600 }, // photo size in mm (whole photo fitted inside, centred in its box)
    photoH: { type: Number, min: 5, max: 600 },
    createdBy: String,
    updatedBy: String,
    ...softDeleteFields(),
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReportFormat", reportFormatSchema);
