// Jamiat master (≈ state).
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const jamiatSchema = new mongoose.Schema(
  {
    // Stored in capitals (see lib/names.js); unique among Jamiats that aren't deleted (index below).
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    // Arabic name (shown in reports); "" = not set.
    nameAr: { type: String, trim: true, maxlength: 200, default: "" },
    isActive: { type: Boolean, default: true },
    ...softDeleteFields(), // status "D" = deleted (kept in the database, can't be restored)
  },
  { timestamps: true }
);
// A deleted Jamiat's name can be used again.
jamiatSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { status: "A" } });

module.exports = mongoose.model("Jamiat", jamiatSchema);
