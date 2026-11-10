const { mongoose } = require("../db");

// saheb      -> Sahebo dashboard            (username + password)
// superadmin -> Super Admin portal          (username + password)
// jc         -> JC portal (sign-in later)   (Gmail only, added by the Super Admin)
const ROLES = ["saheb", "superadmin", "jc"];
const PASSWORD_ROLES = ["saheb", "superadmin"];

const userSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ROLES, required: true },

    // Saheb / Super Admin sign-in name. Not used by JCs.
    username: {
      type: String,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 64,
      match: /^[a-z0-9._-]+$/,
      required() { return PASSWORD_ROLES.includes(this.role); },
    },
    // bcrypt hash — the real password is never stored. Not returned by queries unless asked for.
    passwordHash: { type: String, select: false, required() { return PASSWORD_ROLES.includes(this.role); } },

    // JC Gmail address as typed (lowercase) and its canonical form used to block duplicates:
    // Gmail ignores dots and "+anything", so a.b+x@gmail.com and ab@gmail.com are the same inbox.
    email: { type: String, lowercase: true, trim: true, maxlength: 120, required() { return this.role === "jc"; } },
    emailKey: { type: String, select: false },

    isActive: { type: Boolean, default: true },
    createdBy: String,

    failedLoginCount: { type: Number, default: 0 },
    lockUntil: Date,
    lastLoginAt: Date,
    passwordChangedAt: Date,
  },
  { timestamps: true }
);
// Unique only when present (JCs have no username, Sahebs have no email).
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } });
userSchema.index({ emailKey: 1 }, { unique: true, partialFilterExpression: { emailKey: { $type: "string" } } });

userSchema.methods.toPublic = function () {
  return { id: this._id.toString(), username: this.username || this.email, role: this.role };
};

module.exports = mongoose.model("User", userSchema);
module.exports.ROLES = ROLES;
module.exports.PASSWORD_ROLES = PASSWORD_ROLES;
