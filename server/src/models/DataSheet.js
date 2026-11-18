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

// A choice's colour is any "#rrggbb" picked by the Super Admin (used on the website and in the Excel download).
// Older documents may hold a colour name; it is read as the hex below.
const NAMED = { green: "#8fd19e", red: "#f4a3a3", blue: "#9ec5f0", amber: "#f7d774", orange: "#f8b98a", purple: "#c9b3f2", pink: "#f3abcf", teal: "#8fd8d2", grey: "#c9ced6" };
const HEX = /^#[0-9a-f]{6}$/i;
const toHex = (c) => (HEX.test(String(c || "")) ? String(c).toLowerCase() : NAMED[c] || NAMED.grey);
/** Readable text colour on a background: dark on light colours, white on dark ones. */
function inkFor(hex) {
  const h = toHex(hex);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#111827" : "#ffffff";
}
const DEFAULT_CHOICES = [
  { value: "Active", color: NAMED.green },
  { value: "Inactive", color: NAMED.red },
  { value: "Cold", color: NAMED.blue },
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

module.exports = { DataConfig, DataRow, DEFAULT_CHOICES, HEX, toHex, inkFor, getConfig };
