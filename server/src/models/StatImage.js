// "Stats" images uploaded by the Super Admin and shown on every portal. Newest = current; the rest = history.
// The picture itself is stored here (the server's disk is not kept between deploys); lists never load `data`.
const { mongoose } = require("../db");

const statImageSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 150, default: "" },
    fileName: { type: String, trim: true, maxlength: 150, default: "" },
    type: { type: String, required: true }, // image/png | image/jpeg | image/webp | image/gif
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
statImageSchema.index({ createdAt: -1 });

module.exports = mongoose.model("StatImage", statImageSchema);
