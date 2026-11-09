const { mongoose } = require("../db");

const ROLES = ["admin", "viewer"];

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 64,
      match: /^[a-z0-9._-]+$/,
    },
    // bcrypt hash — the real password is never stored. Not returned by queries unless asked for.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: "viewer", required: true },
    isActive: { type: Boolean, default: true },

    failedLoginCount: { type: Number, default: 0 },
    lockUntil: Date,
    lastLoginAt: Date,
    passwordChangedAt: Date,
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return { id: this._id.toString(), username: this.username, role: this.role };
};

module.exports = mongoose.model("User", userSchema);
module.exports.ROLES = ROLES;
