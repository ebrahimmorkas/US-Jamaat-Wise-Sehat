// Dropdown values managed by the Super Admin:
//   progress / yesNo -> answer choices on the JC form (each with a meaning for the dashboard)
//   mauzeType        -> Mauze Type choices in the Jamaat master
const { mongoose } = require("../db");

const MEANINGS = ["done", "progress", "pending", "notdone", "na"];

const valueSchema = new mongoose.Schema({
  value: { type: String, required: true, trim: true, maxlength: 40 },
  meaning: { type: String, enum: [...MEANINGS, ""], default: "" },
});

const optionListSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    values: { type: [valueSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OptionList", optionListSchema);
module.exports.MEANINGS = MEANINGS;
