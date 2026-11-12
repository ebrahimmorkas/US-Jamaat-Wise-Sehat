// Add a Saheb or Super Admin by Gmail (they sign in with that Google account).
// Use it once for the first Super Admin; after that, users are added on the Super Admin "Users" page.
//   npm run user:create -- --email name@gmail.com --role superadmin
//   npm run user:create -- --email name@gmail.com --role saheb
// JCs are added on the Users page (they also need Jamiats / Jamaats).
const { connectDb, mongoose } = require("../db");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { parseGmail } = require("../lib/gmail");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

(async () => {
  const role = arg("role") || "superadmin";
  const g = parseGmail(arg("email"));
  if (g.error || !["saheb", "superadmin"].includes(role)) {
    console.error("Usage: npm run user:create -- --email name@gmail.com --role superadmin|saheb");
    if (g.error) console.error(g.error);
    process.exit(1);
  }
  if (!(await connectDb())) process.exit(1);
  try {
    const existing = await User.findOne({ emailKey: g.emailKey });
    if (existing) {
      const wasDeleted = existing.status === "D";
      existing.role = role;
      existing.isActive = true;
      existing.status = "A"; // a deleted user (status D) is restored
      existing.deletedAt = undefined;
      existing.deletedBy = undefined;
      existing.activeBeforeDelete = undefined;
      if (wasDeleted) await AuditLog.create({ action: "user_restored", username: "cli", details: { email: g.email, role } });
      existing.jamiats = undefined; // only JCs have assignments
      existing.jamaats = undefined;
      await existing.save();
      console.log(`${g.email} already existed: now an active ${role}.`);
    } else {
      await User.create({ role, email: g.email, emailKey: g.emailKey, createdBy: "cli" });
      await AuditLog.create({ action: "user_created", username: "cli", details: { email: g.email, role } });
      console.log(`Added ${role} ${g.email}. Sign in with this Google account.`);
    }
  } catch (err) {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
})();
