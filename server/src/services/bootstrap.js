// Creates the first admin user from BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD
// if that user does not exist yet. It never changes an existing user's password.
const config = require("../config");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { hashPassword } = require("./auth");

async function ensureBootstrapAdmin() {
  const username = config.bootstrapAdminUsername;
  const password = config.bootstrapAdminPassword;
  if (!username || !password) return;
  if (await User.exists({ username })) return;

  await User.create({ username, passwordHash: await hashPassword(password), role: "admin", passwordChangedAt: new Date() });
  await AuditLog.create({ action: "user_created", username: "system", details: { createdUsername: username, role: "admin", via: "bootstrap" } });
  console.log(`[auth] Created admin user "${username}". You can now remove BOOTSTRAP_ADMIN_PASSWORD from the environment.`);
}

module.exports = { ensureBootstrapAdmin };
