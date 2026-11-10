const { mongoose } = require("../db");

// Everyone signs in with Google. Only Gmail addresses added by a Super Admin can sign in.
//   saheb      -> Sahebo dashboard
//   superadmin -> Super Admin portal (users, masters, portal fields)
//   jc         -> JC portal, only for the Jamiats / Jamaats assigned to them
const ROLES = ["saheb", "superadmin", "jc"];

const userSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ROLES, required: true },

    // Gmail address as typed (lowercase) and its canonical form used for sign-in and to block duplicates:
    // Gmail ignores dots and "+anything", so a.b+x@gmail.com and ab@gmail.com are the same inbox.
    email: { type: String, lowercase: true, trim: true, maxlength: 120 },
    emailKey: { type: String, select: false },

    // Filled from the Google account at sign-in (shown in the top bar).
    name: { type: String, trim: true, maxlength: 120 },
    googleSub: { type: String, select: false }, // Google's permanent account id, remembered at first sign-in

    // Old username of accounts created before Google sign-in (shown until a Gmail is added).
    username: { type: String, lowercase: true, trim: true, maxlength: 64 },

    // JC access: the Jamiats and, inside them, the Jamaats this JC may fill.
    // Saved as explicit lists ("All" in the form ticks everything that exists at that moment).
    jamiats: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Jamiat" }], default: undefined },
    jamaats: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Jamaat" }], default: undefined },

    isActive: { type: Boolean, default: true },
    createdBy: String,
    lastLoginAt: Date,
  },
  { timestamps: true }
);
// Unique only when present.
userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } });
userSchema.index({ emailKey: 1 }, { unique: true, partialFilterExpression: { emailKey: { $type: "string" } } });

userSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    email: this.email || "",
    name: this.name || "",
    username: this.name || this.email || this.username || "",
    role: this.role,
  };
};

module.exports = mongoose.model("User", userSchema);
module.exports.ROLES = ROLES;
