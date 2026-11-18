// "Data" tab: a table uploaded by the Super Admin from Excel (columns come from the file's first row).
//  - DataConfig (one document, key "main"): the columns of the current upload, which ones are dropdowns,
//    and the dropdown choices (one list for every dropdown column) with their colours.
//  - DataRow: one row of the file, linked to its Jamiat and Jamaat. `cells` follow DataConfig.columns;
//    a column marked as dropdown keeps its Excel value and gets a status (`picks`) that JCs choose.
//  - `version` goes up with every upload: rows of an older upload are ignored (and removed once the new one is saved).
const { mongoose } = require("../db");

const choiceSchema = new mongoose.Schema({
  value: { type: String, required: true, trim: true, maxlength: 30 },
  color: { type: String, required: true },
});

const columnSchema = new mongoose.Schema(
  { name: { type: String, required: true, maxlength: 120 }, dropdown: { type: Boolean, default: false } },
  { _id: false }
);

const dataConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    choices: { type: [choiceSchema], default: [] },
    columns: { type: [columnSchema], default: [] },
    jamiatCol: { type: Number, default: -1 },
    jamaatCol: { type: Number, default: -1 },
    version: { type: Number, default: 0 },
    fileName: { type: String, default: "" },
    rowCount: { type: Number, default: 0 },
    uploadedAt: { type: Date },
    uploadedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

const dataRowSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  jamiat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamiat", required: true },
  jamaat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamaat", required: true },
  order: { type: Number, required: true }, // position in the uploaded file
  cells: { type: [String], default: [] }, // the Excel values, exactly as uploaded (never changed)
  picks: { type: [String], default: [] }, // status chosen per dropdown column (same positions as cells; "" = not set)
  editedBy: { type: String },
  editedAt: { type: Date },
});
dataRowSchema.index({ version: 1, jamaat: 1, order: 1 });

// Colours a choice can have: light / dark website colours; Excel uses the light ones.
const PALETTE = {
  green: { label: "Green", bg: "#d3f3df", ink: "#0b5d2e", darkBg: "#174a2c", darkInk: "#bdf0d1" },
  red: { label: "Red", bg: "#fde0de", ink: "#9a1c14", darkBg: "#5a1d1a", darkInk: "#ffcdc8" },
  blue: { label: "Blue", bg: "#dbe9ff", ink: "#1e4a94", darkBg: "#1c3460", darkInk: "#c9ddff" },
  amber: { label: "Yellow", bg: "#fdeec8", ink: "#7a4b00", darkBg: "#4d3a0c", darkInk: "#ffe3a3" },
  orange: { label: "Orange", bg: "#ffe4d1", ink: "#8a3a0a", darkBg: "#55301a", darkInk: "#ffd2b3" },
  purple: { label: "Purple", bg: "#ece3ff", ink: "#4b2a96", darkBg: "#33255e", darkInk: "#ddd0ff" },
  pink: { label: "Pink", bg: "#fde1ef", ink: "#8f1f5a", darkBg: "#57203f", darkInk: "#ffcae4" },
  teal: { label: "Teal", bg: "#d4f2f0", ink: "#0b5b57", darkBg: "#134542", darkInk: "#b8ece7" },
  grey: { label: "Grey", bg: "#e9ebef", ink: "#3b4250", darkBg: "#343a46", darkInk: "#dfe3ea" },
};
const DEFAULT_CHOICES = [
  { value: "Active", color: "green" },
  { value: "Inactive", color: "red" },
  { value: "Cold", color: "blue" },
];

const DataConfig = mongoose.model("DataConfig", dataConfigSchema);
const DataRow = mongoose.model("DataRow", dataRowSchema);

/** The one config document (created with the default choices the first time). */
async function getConfig() {
  return DataConfig.findOneAndUpdate(
    { key: "main" },
    { $setOnInsert: { key: "main", choices: DEFAULT_CHOICES } },
    { upsert: true, returnDocument: "after" }
  );
}

module.exports = { DataConfig, DataRow, PALETTE, DEFAULT_CHOICES, getConfig };
