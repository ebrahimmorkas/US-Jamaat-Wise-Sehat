// Runs every time MongoDB connects. Each step is safe to repeat.
const { mongoose } = require("../db");
const User = require("../models/User");
const Session = require("../models/Session");
const PortalField = require("../models/PortalField");
const Entry = require("../models/Entry");
const AuditLog = require("../models/AuditLog");
const { seedLists } = require("./lists");
const { seedFields, invalidate } = require("./fields");
const { markDeleted, isDeleted } = require("../lib/softDelete");

// One-time changes: each id runs once and is recorded in the "migrations" collection,
// so later edits by the Super Admin are never overwritten.
async function once(id, fn) {
  const col = mongoose.connection.db.collection("migrations");
  if (await col.findOne({ _id: id })) return;
  const changes = await fn();
  await col.insertOne({ _id: id, at: new Date() });
  invalidate();
  if (changes.length) {
    console.log(`[migrate] ${id}: ${changes.length} change(s)`);
    await AuditLog.create({ action: "field_updated", username: "system", role: "system", target: { type: "fields", id, label: "Form update (automatic)" }, changes });
  }
}

// Nov 2026 form changes asked by the client:
//  - "Regular Khidmat" heading -> "Event Status"
//  - "Aamil Uploaded?" -> "Mahal Us Shifa report filled on amalat.com?"
//  - "Before 16mi?" removed (inactive if it was ever answered), a date question added after it
//  - Hifz us Sehhat questions keep only Yes and Pending (saved "No" / "Not Applicable" become Pending)
async function formUpdate2026_11() {
  const changes = [];
  const sec = await PortalField.find({ section: "Regular Khidmat" });
  for (const f of sec) {
    f.section = "Event Status";
    await f.save();
    changes.push({ field: `${f.key}.section`, label: `Section of "${f.label}"`, from: "Regular Khidmat", to: "Event Status" });
  }

  const aamil = await PortalField.findOne({ key: "aamil" });
  if (aamil && aamil.label === "Aamil Uploaded?") {
    aamil.label = "Mahal Us Shifa report filled on amalat.com?";
    await aamil.save();
    changes.push({ field: "aamil.label", label: "Question", from: "Aamil Uploaded?", to: aamil.label });
  }

  const before = await PortalField.findOne({ key: "before16mi" });
  let at = aamil ? aamil.order + 1 : null;
  if (before) {
    if (await Entry.exists({ "values.before16mi": { $exists: true } })) {
      before.isActive = false;
      await before.save();
      changes.push({ field: "before16mi.isActive", label: `Active: "${before.label}"`, from: true, to: false });
    } else {
      markDeleted(before, "system"); // status "D" (kept, restorable)
      await before.save();
      changes.push({ field: "before16mi", label: "Question deleted (status D)", from: before.label, to: null });
    }
  }
  if (aamil && !(await PortalField.exists({ key: "reportDate" }))) {
    await PortalField.updateMany({ order: { $gte: at }, key: { $ne: "before16mi" } }, { $inc: { order: 1 } });
    await PortalField.create({ key: "reportDate", label: "Date the report was filled", section: aamil.section, type: "date", required: false, showOnDashboard: false, order: at, options: [] });
    changes.push({ field: "reportDate", label: "Question added (date)", from: null, to: "Date the report was filled" });
  }

  for (const key of ["hsCoordinator", "caseFollow"]) {
    const f = await PortalField.findOne({ key });
    if (!f) continue;
    const pending = f.options.find((o) => o.value === "Pending");
    const drop = f.options.filter((o) => ["No", "Not Applicable"].includes(o.value) && !isDeleted(o));
    if (!pending || !drop.length) continue;
    for (const o of drop) {
      const n = (await Entry.updateMany({ [`values.${key}`]: o.value }, { $set: { [`values.${key}`]: "Pending" } })).modifiedCount;
      markDeleted(o, "system"); // status "D" (kept, restorable)
      changes.push({ field: `${key}.options`, label: `Answer deleted (status D) from "${f.label}"`, from: o.value + (n ? ` (${n} saved form(s) set to Pending)` : ""), to: null });
    }
    await f.save();
  }
  return changes;
}

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

  // 5) One-time form changes.
  await once("form-2026-11", formUpdate2026_11);
}

module.exports = { migrate };
