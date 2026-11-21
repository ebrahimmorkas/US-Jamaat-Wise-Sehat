// A form the Super Admin builds (instead of a Google Form) for Jamaat Coordinators to fill.
//   stage ("status" in the API):  draft -> testing (only testers can fill) -> published -> closed (can be reopened)
//   access:  signed_in     = sign in with Google as a Jamaat Coordinator
//            personal_link = no sign-in; each person gets their own signed link (their Gmail is inside it)
//            anyone        = anyone with the link; they type their email (not verified)
// Times are exact moments (UTC); every screen shows them in the viewer's own time zone.
const { mongoose } = require("../db");
const { softDeleteFields } = require("../lib/softDelete");

const STATUSES = ["draft", "testing", "published", "closed"];
const ACCESS = ["signed_in", "personal_link", "anyone"];

const fileSchema = new mongoose.Schema(
  { fileId: String, filePath: String, url: String, endpoint: String, width: Number, height: Number, name: String, size: Number, type: String },
  { _id: false }
);

const optionSchema = new mongoose.Schema({ id: { type: String, required: true }, label: { type: String, required: true, trim: true, maxlength: 200 } }, { _id: false });

// One question (or a heading / information text). `key` never changes, so answers stay linked after renames.
const fieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, match: /^f_[a-z0-9]{6,16}$/ },
    type: { type: String, required: true },
    label: { type: String, trim: true, maxlength: 300, default: "" },
    help: { type: String, trim: true, maxlength: 2000, default: "" },
    placeholder: { type: String, trim: true, maxlength: 150, default: "" },
    required: { type: Boolean, default: false },
    options: { type: [optionSchema], default: undefined },
    // number: lowest / highest value · text: fewest / most characters · checkboxes & multi-select: fewest / most choices
    // rating: max = number of stars
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    // uploads: allowed extensions (empty = the form's image defaults, or every allowed one), size limit, how many files
    accept: { type: [String], default: undefined },
    maxSizeMb: { type: Number, default: null },
    maxFiles: { type: Number, default: null },
    // Removed from the form after people answered it: hidden from the form, kept with its answers.
    hidden: { type: Boolean, default: false },
  },
  { _id: false }
);

const formSchema = new mongoose.Schema(
  {
    // Random public code used in links (/f/<code>) so the database id is never shown.
    code: { type: String, unique: true, sparse: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    topImage: { type: fileSchema, default: undefined },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    stage: { type: String, enum: STATUSES, default: "draft", index: true }, // ("status" is the delete flag)
    access: { type: String, enum: ACCESS, default: "personal_link" },
    // How many times one person may fill it; null = no limit (never 0).
    maxPerPerson: { type: Number, default: null, min: 1 },
    allowEdit: { type: Boolean, default: false }, // edit a sent response until the end time
    sendCopy: { type: Boolean, default: false },  // email a copy of the response to the person (email part)
    // Email every Jamaat Coordinator the form link when it is published (once; progress in `announce`).
    announceEmail: { type: Boolean, default: false },
    announce: {
      type: new mongoose.Schema({ at: Date, finishedAt: Date, status: String, total: Number, sent: Number, failed: Number, error: String }, { _id: false }),
      default: undefined,
    },
    // Reminders: hours after the start time (never after the end) + the email template (email part).
    reminderHours: { type: [Number], default: [] },
    reminderTemplate: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Defaults for image questions (each image question can set its own).
    imageExt: { type: [String], default: undefined },
    imageMaxMb: { type: Number, default: null },
    fields: { type: [fieldSchema], default: [] },
    publishedAt: Date,
    createdBy: String,
    updatedBy: String,
    ...softDeleteFields(),
  },
  { timestamps: true }
);

formSchema.pre("validate", function setCode() {
  if (!this.code) this.code = require("../services/forms").newCode();
});

module.exports = mongoose.model("Form", formSchema);
module.exports.STATUSES = STATUSES;
module.exports.ACCESS = ACCESS;
