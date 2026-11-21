// A file attached while writing an email (kept in ImageKit, private). It belongs to an email once that is
// saved; files never used are removed after a day.
const { mongoose } = require("../db");

const emailFileSchema = new mongoose.Schema(
  {
    fileId: String, filePath: String, url: String, endpoint: String,
    name: { type: String, default: "" }, size: Number, type: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    used: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmailFile", emailFileSchema);
