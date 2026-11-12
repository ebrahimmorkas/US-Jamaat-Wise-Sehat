// Simple dropdown lists managed by the Super Admin (currently: mauzeType).
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const valueSchema = new mongoose.Schema({
  value: { type: String, required: true, trim: true, maxlength: 40 },
  meaning: { type: String, default: "" }, // unused for simple lists (kept for older documents)
  ...softDeleteFields(), // a removed value keeps status "D" (hidden, restorable)
});

const optionListSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    values: { type: [valueSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OptionList", optionListSchema);
