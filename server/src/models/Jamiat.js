// Jamiat master (≈ state).
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const jamiatSchema = new mongoose.Schema(
  {
    // Stored in capitals (see lib/names.js) and unique (deleted ones included: restore instead of re-adding).
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80, unique: true },
    isActive: { type: Boolean, default: true },
    ...softDeleteFields(), // status "D" = deleted (kept, restorable)
  },
  { timestamps: true }
);

module.exports = mongoose.model("Jamiat", jamiatSchema);
