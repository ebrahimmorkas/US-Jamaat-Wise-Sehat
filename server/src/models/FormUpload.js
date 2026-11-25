// A file someone uploaded while filling a form. It belongs to a response once the form is sent;
// files never sent with a response are removed after a day.
// Photos Media adds on Choose photos (report: true) belong to a Jamaat instead of a response. A photo Media
// deletes there is marked reportStatus "D": it is no longer in Choose photos or reports (the Jamaat's response
// still has it).
const { mongoose } = require("../db");

const formUploadSchema = new mongoose.Schema(
  {
    form: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true, index: true },
    field: { type: String, required: true },
    kind: { type: String, enum: ["image", "video", "file"], required: true },
    fileId: String,
    filePath: String,
    url: String,
    endpoint: String,
    name: { type: String, default: "" },
    size: Number,
    type: String,
    tokenHash: { type: String, select: false }, // only the browser that uploaded it can attach it
    response: { type: mongoose.Schema.Types.ObjectId, ref: "FormResponse", default: null, index: true },
    report: { type: Boolean, default: undefined },
    jamaat: { type: mongoose.Schema.Types.ObjectId, ref: "Jamaat", default: undefined },
    addedBy: { type: new mongoose.Schema({ email: String, name: String, role: String }, { _id: false }), default: undefined },
    reportStatus: { type: String, enum: ["A", "D"], default: undefined },
    reportDeletedAt: Date,
    reportDeletedBy: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("FormUpload", formUploadSchema);
