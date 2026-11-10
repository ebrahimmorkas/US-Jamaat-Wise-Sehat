// Jamiat master (≈ state).
const { mongoose } = require("../db");

const jamiatSchema = new mongoose.Schema(
  {
    // Stored in capitals (see lib/names.js) and unique.
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80, unique: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Jamiat", jamiatSchema);
