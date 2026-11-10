// Simple dropdown lists managed by the Super Admin (currently: mauzeType).
const { mongoose } = require("../db");

const valueSchema = new mongoose.Schema({
  value: { type: String, required: true, trim: true, maxlength: 40 },
  meaning: { type: String, default: "" }, // unused for simple lists (kept for older documents)
});

const optionListSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    values: { type: [valueSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OptionList", optionListSchema);
