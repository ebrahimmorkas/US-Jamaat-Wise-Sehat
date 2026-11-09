const { mongoose } = require("../db");

// One document per login. The refresh token's id (jti) is stored only as a SHA-256 hash.
// Revoking a session logs that device out immediately (the access token is checked against it).
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jtiHash: { type: String, required: true },
    prevJtiHash: String,          // previous refresh token, accepted for a few seconds (two tabs refreshing at once)
    rotatedAt: Date,
    expiresAt: { type: Date, required: true, expires: 0 }, // MongoDB deletes it after this time
    revokedAt: Date,
    revokeReason: String,
    lastUsedAt: Date,
    ip: String,
    userAgent: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
