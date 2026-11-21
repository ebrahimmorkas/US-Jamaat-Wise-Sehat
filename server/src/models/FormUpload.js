// A file someone uploaded while filling a form. It belongs to a response once the form is sent;
// files never sent with a response are removed after a day.
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("FormUpload", formUploadSchema);
