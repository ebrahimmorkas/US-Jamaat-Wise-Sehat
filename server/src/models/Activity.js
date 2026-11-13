// One activity of a question for one Hijri month, e.g. Tibb · Jumadal Ukhra 1448 · "Week 1: Health talk".
// Only questions with "Monthly activities" switched on have them; the Super Admin adds them each month.
// The JC picks the activity, then its status. Each activity's answer is saved in the entry as
//   values["<field key>:<activity id>"] (and its comment as comments["<field key>:<activity id>"]).
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const activitySchema = new mongoose.Schema(
  {
    field: { type: String, required: true },  // PortalField.key
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    order: { type: Number, default: 0 },
    ...softDeleteFields(), // status "D" = deleted (kept, restorable)
  },
  { timestamps: true }
);
activitySchema.index({ field: 1, month: 1, order: 1 });

module.exports = mongoose.model("Activity", activitySchema);
