// Create a user, or reset a user's password.
//   npm run user:create -- --username ali --password "S3cret!" --role saheb      (or superadmin)
//   npm run user:create -- --username ali --password "New-Pass" --reset
const { connectDb, mongoose } = require("../db");
const User = require("../models/User");
const { PASSWORD_ROLES } = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { hashPassword } = require("../services/auth");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  const username = String(arg("username") || "").trim().toLowerCase();
  const password = arg("password");
  const role = arg("role") || "saheb";
  const reset = process.argv.includes("--reset");

  if (!username || !password) {
    console.error('Usage: npm run user:create -- --username <name> --password <password> [--role saheb|superadmin] [--reset]');
    process.exit(1);
  }
  if (!PASSWORD_ROLES.includes(role)) {
    console.error(`Role must be one of: ${PASSWORD_ROLES.join(", ")} (JC users are added by Gmail in the Super Admin portal)`);
    process.exit(1);
  }
  if (!(await connectDb())) process.exit(1);

  try {
    const existing = await User.findOne({ username });
    if (existing && !reset) {
      console.error(`User "${username}" already exists. Add --reset to change the password.`);
      process.exitCode = 1;
    } else if (existing) {
      existing.passwordHash = await hashPassword(password);
      existing.passwordChangedAt = new Date();
      existing.failedLoginCount = 0;
      existing.lockUntil = undefined;
      await existing.save();
      await AuditLog.create({ action: "user_password_reset", username: "cli", details: { targetUsername: username } });
      console.log(`Password reset for "${username}".`);
    } else {
      await User.create({ username, passwordHash: await hashPassword(password), role, passwordChangedAt: new Date() });
      await AuditLog.create({ action: "user_created", username: "cli", details: { createdUsername: username, role } });
      console.log(`Created ${role} "${username}".`);
    }
  } catch (err) {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
})();
