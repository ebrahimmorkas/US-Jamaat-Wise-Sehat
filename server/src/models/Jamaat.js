// Jamaat master (≈ city). Belongs to one Jamiat.
const { mongoose } = require("../db");

const count = { type: Number, min: 0, max: 1000000, validate: { validator: (v) => v == null || Number.isInteger(v), message: "must be a whole number" } };

const jamaatSchema = new mongoose.Schema(
  {
    jamiat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamiat", required: true, index: true },
    // Stored in capitals (see lib/names.js); unique inside its Jamiat.
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    // One of the Mauze Type dropdown values (checked by the API), or "".
    mauzeType: { type: String, trim: true, maxlength: 40, default: "" },
    houseCount: { ...count, default: null },
    children: { ...count, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
jamaatSchema.index({ jamiat: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Jamaat", jamaatSchema);
