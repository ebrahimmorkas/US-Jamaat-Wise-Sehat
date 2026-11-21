// One filled form. Uploaded files are stored in ImageKit (FormUpload) and listed in the answer.
const { mongoose } = require("../db");

const formResponseSchema = new mongoose.Schema(
  {
    form: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true, index: true },
    isTest: { type: Boolean, default: false }, // filled while the form was in "Testing"
    via: { type: String, enum: ["signed_in", "personal_link", "anyone", "jc_on_behalf"], required: true },
    // A JC filled it for one of their Jamaats, on behalf of its Jamaat Coordinator (email/name above = the Coordinator's).
    onBehalf: { type: Boolean, default: false },
    filledBy: { type: new mongoose.Schema({ user: mongoose.Schema.Types.ObjectId, email: String, name: String, role: String }, { _id: false }), default: undefined },
    editedBy: { type: new mongoose.Schema({ email: String, name: String, role: String }, { _id: false }), default: undefined }, // last change
    email: { type: String, lowercase: true, trim: true, maxlength: 200 }, // who filled it (typed = not verified for "anyone")
    emailKey: { type: String, index: true }, // same person however the Gmail is written
    verified: { type: Boolean, default: false }, // signed in or personal link
    name: { type: String, trim: true, maxlength: 200, default: "" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    jamiat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamiat", default: null, index: true }, // the response's Jamiat and Jamaat
    jamaat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamaat", default: null, index: true },
    answers: { type: mongoose.Schema.Types.Mixed, default: {} }, // { <field key>: value }
    editKeyHash: { type: String, select: false }, // "anyone" forms: the browser's key to edit this response
    edits: { type: Number, default: 0 },
    editedAt: Date,
  },
  { timestamps: true, minimize: false }
);
formResponseSchema.index({ form: 1, emailKey: 1, isTest: 1 });

module.exports = mongoose.model("FormResponse", formResponseSchema);
