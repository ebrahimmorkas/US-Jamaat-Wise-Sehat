// One question on the JC portal: a dropdown with its own answers, or a date.
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const MEANINGS = ["done", "progress", "pending", "notdone", "na"];
const TYPES = ["select", "date"]; // select = dropdown (answers below) · date = date picker (no answers)

const optionSchema = new mongoose.Schema({
  value: { type: String, required: true, trim: true, maxlength: 40 },
  meaning: { type: String, enum: MEANINGS, required: true },
  ...softDeleteFields(), // a removed answer keeps status "D" (hidden, restorable)
});

const portalFieldSchema = new mongoose.Schema(
  {
    // Where the answer is stored in each entry (entries.values.<key>). Set once, never changed,
    // so renaming the question keeps all saved answers.
    key: { type: String, required: true, unique: true, match: /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/ },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    section: { type: String, trim: true, maxlength: 60, default: "" },
    type: { type: String, enum: TYPES, default: "select" },
    // A free-text comment box under the question on the JC portal (entries.comments.<key>).
    hasComment: { type: Boolean, default: false },
    // Monthly activities (dropdown questions only): the Super Admin adds a list of activities for each
    // month; the JC picks an activity and answers it. Each activity gets its own answer (and comment).
    hasActivities: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    required: { type: Boolean, default: true },
    showOnDashboard: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    ...softDeleteFields(), // status "D" = deleted question (kept, restorable)
    options: { type: [optionSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PortalField", portalFieldSchema);
module.exports.MEANINGS = MEANINGS;
module.exports.TYPES = TYPES;
