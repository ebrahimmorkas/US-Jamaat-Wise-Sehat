// Runs every time MongoDB connects. Each step is safe to repeat.
const User = require("../models/User");
const { seedLists } = require("./lists");

async function migrate() {
  // 1) Old roles -> new roles. The old "admin"/"viewer" accounts (e.g. "sehhat") become Sahebs.
  const res = await User.collection.updateMany({ role: { $in: ["admin", "viewer"] } }, { $set: { role: "saheb" } });
  if (res.modifiedCount) console.log(`[migrate] ${res.modifiedCount} user(s) changed to role "saheb"`);

  // 2) User indexes: username / Gmail are unique only when present.
  await User.syncIndexes();

  // 3) Dropdown lists.
  await seedLists();
}

module.exports = { migrate };
