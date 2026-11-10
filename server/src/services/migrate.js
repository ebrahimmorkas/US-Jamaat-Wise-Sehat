// Runs every time MongoDB connects. Each step is safe to repeat.
const User = require("../models/User");
const Session = require("../models/Session");
const { seedLists } = require("./lists");
const { seedFields } = require("./fields");

async function migrate() {
  // 1) Old roles -> new roles. The old "admin"/"viewer" accounts (e.g. "sehhat") become Sahebs.
  const res = await User.collection.updateMany({ role: { $in: ["admin", "viewer"] } }, { $set: { role: "saheb" } });
  if (res.modifiedCount) console.log(`[migrate] ${res.modifiedCount} user(s) changed to role "saheb"`);

  // 2) Google sign-in only: remove stored passwords, and end sessions of accounts that have no Gmail yet.
  const pw = await User.collection.updateMany(
    { $or: [{ passwordHash: { $exists: true } }, { failedLoginCount: { $exists: true } }, { lockUntil: { $exists: true } }] },
    { $unset: { passwordHash: "", failedLoginCount: "", lockUntil: "", passwordChangedAt: "" } }
  );
  if (pw.modifiedCount) console.log(`[migrate] Removed passwords from ${pw.modifiedCount} user(s) (Google sign-in only)`);
  const noEmail = await User.find({ $or: [{ email: { $exists: false } }, { email: "" }] }).select("_id").lean();
  if (noEmail.length) {
    await Session.updateMany({ user: { $in: noEmail.map((u) => u._id) }, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "no_gmail" } });
  }

  // 3) User indexes: username / Gmail are unique only when present.
  await User.syncIndexes();

  // 4) Mauze Type list, then the JC form questions.
  await seedLists();
  await seedFields();
}

module.exports = { migrate };
