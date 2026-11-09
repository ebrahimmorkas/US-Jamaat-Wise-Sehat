const { mongoose } = require("../db");

// The latest data read from the Google Sheet (one document, key "latest").
const jamaatSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    values: { type: Map, of: String, default: {} },
    remarks: { type: String, default: "" },
  },
  { _id: false }
);

const snapshotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    month: { type: String, default: "" },
    jamiats: [
      new mongoose.Schema({ name: String, jamaats: [jamaatSchema] }, { _id: false }),
    ],
    failed: [{ sheet: String, error: String, _id: false }],
    source: String,
    syncedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Snapshot", snapshotSchema);
