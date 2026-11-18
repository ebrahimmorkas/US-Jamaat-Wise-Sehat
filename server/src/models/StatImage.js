// "Stats" images uploaded by the Super Admin and shown on every portal. Newest = current; the rest = history.
// The picture itself lives in ImageKit as a private file; this keeps where it is and its details.
const { mongoose } = require("../db");

const statImageSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 150, default: "" },
    fileName: { type: String, trim: true, maxlength: 150, default: "" },
    type: { type: String, required: true }, // image/png | image/jpeg | image/webp | image/gif
    size: { type: Number, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    // ImageKit
    fileId: { type: String, required: true },
    filePath: { type: String, required: true },
    url: { type: String, required: true },      // private: opened only through a signed link
    endpoint: { type: String, required: true }, // e.g. https://ik.imagekit.io/<id>
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
statImageSchema.index({ createdAt: -1 });

module.exports = mongoose.model("StatImage", statImageSchema);
