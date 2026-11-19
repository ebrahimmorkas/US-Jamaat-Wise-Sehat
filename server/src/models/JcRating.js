// Star rating of a JC (1-5), set by the Super Admin. Seen by the Saheb and the Super Admin only:
// kept apart from the User record so nothing a JC can load ever carries it.
const { mongoose } = require("../db");

const jcRatingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    stars: { type: Number, required: true, min: 1, max: 5 },
    ratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("JcRating", jcRatingSchema);
