// Jamaat master (≈ city). Belongs to one Jamiat.
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const count = { type: Number, min: 0, max: 1000000, validate: { validator: (v) => v == null || Number.isInteger(v), message: "must be a whole number" } };

const jamaatSchema = new mongoose.Schema(
  {
    jamiat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamiat", required: true, index: true },
    // Stored in capitals (see lib/names.js); unique inside its Jamiat.
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    // Arabic name (shown in reports; Jamaat Coordinators still choose the English name); "" = not set.
    nameAr: { type: String, trim: true, maxlength: 200, default: "" },
    // One of the Mauze Type dropdown values (checked by the API), or "".
    mauzeType: { type: String, trim: true, maxlength: 40, default: "" },
    houseCount: { ...count, default: null },
    children: { ...count, default: null },
    // Country + time zone: times in emails are written in the Jamaat's own time ("" = not tagged yet -> India time).
    country: { type: String, trim: true, maxlength: 60, default: "" },
    timeZone: { type: String, trim: true, maxlength: 60, default: "" },
    isActive: { type: Boolean, default: true },
    ...softDeleteFields(), // status "D" = deleted (kept in the database, can't be restored)
  },
  { timestamps: true }
);
// Unique inside its Jamiat among Jamaats that aren't deleted (a deleted one's name can be used again).
jamaatSchema.index({ jamiat: 1, name: 1 }, { unique: true, partialFilterExpression: { status: "A" } });

module.exports = mongoose.model("Jamaat", jamaatSchema);
