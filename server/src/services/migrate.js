// Runs every time MongoDB connects. Each step is safe to repeat.
const { mongoose } = require("../db");
const User = require("../models/User");
const Session = require("../models/Session");
const PortalField = require("../models/PortalField");
const Entry = require("../models/Entry");
const Activity = require("../models/Activity");
const AuditLog = require("../models/AuditLog");
const { seedLists } = require("./lists");
const { seedFields, invalidate } = require("./fields");
const { markDeleted, isDeleted, notDeleted: notDeletedQ } = require("../lib/softDelete");

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

// Nov 2026: months become Hijri months (Misri calendar), and Tibb / Riyadah / Nazafat get monthly activities.
//  - Forms saved under English months ("2026-11"; Hijri years are 14xx) are removed, as asked by the client
//    ("start fresh"). They are copied to the "entries_gregorian_backup" collection first.
//  - "Monthly activities" switched on for Tibb, Riyadah and Nazafat.
async function hijriActivities2026_11() {
  const changes = [];
  const old = { month: { $gte: "1900" } };
  const n = await Entry.countDocuments(old);
  if (n) {
    const docs = await Entry.collection.find(old).toArray();
    const backup = mongoose.connection.db.collection("entries_gregorian_backup");
    await backup.insertMany(docs.map((d) => ({ ...d, backedUpAt: new Date() })), { ordered: false }).catch((err) => {
      if (err.code !== 11000) throw err; // already copied by an earlier, interrupted run
    });
    await Entry.deleteMany(old);
    changes.push({ field: "entries", label: "Saved forms of English months removed (now Hijri months; copy kept in entries_gregorian_backup)", from: n, to: 0 });
  }
  for (const key of ["tibb", "riyadah", "nazafat"]) {
    const f = await PortalField.findOne({ key, type: { $ne: "date" } });
    if (!f || f.hasActivities) continue;
    f.hasActivities = true;
    await f.save();
    changes.push({ field: `${key}.hasActivities`, label: `Monthly activities: "${f.label}"`, from: false, to: true });
  }
  return changes;
}

// Nov 2026: the "No" answer is removed from every question, as asked by the client.
//  - "No" gets status "D" (kept, restorable from Portal Fields).
//  - Saved "No" answers (also of activities, "<key>:<activity id>") become "Pending" when the question has it.
async function removeNo2026_11() {
  const changes = [];
  const fields = await PortalField.find({ "options.value": { $regex: /^\s*no\s*$/i } });
  for (const f of fields) {
    const drop = f.options.filter((o) => /^\s*no\s*$/i.test(o.value) && !isDeleted(o));
    if (!drop.length) continue;
    const pending = f.options.find((o) => o.meaning === "pending" && !isDeleted(o) && !drop.includes(o));
    let n = 0;
    if (pending) {
      const keys = [f.key, ...(await Activity.find({ field: f.key }).select("_id").lean()).map((a) => `${f.key}:${a._id}`)];
      for (const k of keys) {
        for (const o of drop) {
          n += (await Entry.updateMany({ [`values.${k}`]: o.value }, { $set: { [`values.${k}`]: pending.value } })).modifiedCount;
        }
      }
    }
    for (const o of drop) markDeleted(o, "system");
    await f.save();
    changes.push({
      field: `${f.key}.options`, label: `Answer deleted (status D) from "${f.label}"`,
      from: "No" + (n ? ` (${n} saved answer(s) set to ${pending.value})` : ""), to: null,
    });
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
  await once("hijri-activities-2026-11", hijriActivities2026_11);
  await once("remove-no-2026-11", removeNo2026_11);

  // 6) Forms: every form has a public code (links never show the database id).
  const Form = require("../models/Form");
  const { newCode } = require("./forms");
  for (const f of await Form.find({ code: { $exists: false } }).select("_id").lean()) {
    await Form.updateOne({ _id: f._id, code: { $exists: false } }, { $set: { code: newCode() } });
  }

  // 7) Nov 2026: Jamiats / Jamaats from master_check.xlsx that the portal didn't have, and Arabic names.
  await once("masters-2026-11", mastersNov2026);
  await once("masters-2026-11-kuwait", mastersKuwaitAmmar);

  // 8) Country of each Jamaat: every Jamaat not tagged yet is India, except the overseas Jamiats (tagged later).
  //    Runs every start, so Jamaats added later are tagged too; a country set by hand is never changed.
  await tagIndia();
}

/**
 * One-time (seed/masters-2026-11.json, made from master_check.xlsx + Arabic Names.xlsx):
 *  - adds the Jamiats and Jamaats of master_check that the portal doesn't have (active, no JC assigned yet);
 *    a Jamaat already in the portal under another spelling (the `alias` list, e.g. VIRAMGAM (ALIGRAH)) is not added again;
 *    a deleted one is left deleted (not restored, not added twice);
 *  - fills the Arabic name of every Jamiat / Jamaat that matches by name (only where it is empty, so a name
 *    typed by the Super Admin is never overwritten).
 * Nothing is renamed or removed. One summary line goes to the audit log.
 */
async function mastersNov2026() {
  const Jamiat = require("../models/Jamiat");
  const Jamaat = require("../models/Jamaat");
  const data = require("../seed/masters-2026-11.json");
  const jtBy = new Map((await Jamiat.find({}).lean()).map((j) => [j.name, j]));
  const findJt = (name) => jtBy.get(name) || (data.jamiatAlias[name] || []).map((a) => jtBy.get(a)).find(Boolean);
  const needed = new Set(data.jamaats.filter((r) => r.add).map((r) => r.jamiat));
  const out = { jamiats: [], jamaats: [], arabicJamiats: 0, arabicJamaats: 0 };
  for (const r of data.jamiats) {
    const doc = findJt(r.name);
    if (!doc) {
      if (!needed.has(r.name)) continue;
      const j = (await Jamiat.create({ name: r.name, nameAr: r.nameAr })).toObject();
      jtBy.set(j.name, j);
      out.jamiats.push(r.name);
    } else if (r.nameAr && !doc.nameAr) {
      await Jamiat.updateOne({ _id: doc._id }, { $set: { nameAr: r.nameAr } });
      out.arabicJamiats += 1;
    }
  }
  const key = (jt, n) => `${jt}|${n}`;
  const jmBy = new Map((await Jamaat.find({}).select("jamiat name nameAr").lean()).map((m) => [key(m.jamiat, m.name), m]));
  const sets = [];
  const adds = [];
  for (const r of data.jamaats) {
    const jt = findJt(r.jamiat);
    if (!jt || isDeleted(jt)) continue;
    const have = [r.name, ...(r.alias || [])].map((n) => jmBy.get(key(jt._id, n))).find(Boolean);
    if (have) {
      if (r.nameAr && !have.nameAr) sets.push({ updateOne: { filter: { _id: have._id }, update: { $set: { nameAr: r.nameAr } } } });
    } else if (r.add) {
      adds.push({ jamiat: jt._id, name: r.name, nameAr: r.nameAr, mauzeType: r.mauzeType, isActive: true });
      out.jamaats.push(`${r.name} (${jt.name})`);
    }
  }
  if (sets.length) await Jamaat.bulkWrite(sets);
  if (adds.length) await Jamaat.insertMany(adds);
  out.arabicJamaats = sets.length;
  console.log(`[migrate] master_check: ${out.jamiats.length} Jamiat(s) and ${adds.length} Jamaat(s) added; Arabic names set on ${out.arabicJamiats} Jamiat(s) and ${out.arabicJamaats} Jamaat(s)`);
  await AuditLog.create({
    action: "master_created", username: "system", role: "system",
    target: { type: "masters", id: "masters-2026-11", label: "Jamiats / Jamaats from master_check + Arabic names (automatic)" },
    details: { jamiatsAdded: out.jamiats, jamaatsAdded: out.jamaats.length, jamaats: out.jamaats, arabicJamiats: out.arabicJamiats, arabicJamaats: out.arabicJamaats + adds.filter((a) => a.nameAr).length },
  });
  return [];
}

/**
 * One-time, after masters-2026-11 (the user: "master_check is the right one" for Kuwait, AMMAR NAGAR (INDORE) separate):
 * - KUWAIT: our 9 area names are RENAMED to master_check's Mohalla names (same records, so users / entries / responses
 *   stay linked) and the 10th Mohalla (BADRI) is added.
 * - AMMAR NAGAR (INDORE) is added to INDORE as its own Jamaat (not the same as AMMAR NAGAR (NOORANI NAGAR)).
 * Arabic names from the seed file are set where empty. Skips anything already renamed / added by hand.
 */
const KUWAIT_RENAME = {
  "ABBASIYA (KUWAIT)": "EZZY MOHALLA (ABBASIYA - KUWAIT)",
  "ABRAQ KHAITAIN (KUWAIT)": "SAIFEE MOHALLA (ABRAQ KHAITAN-KUWAIT)",
  "FAHAHIL (KUWAIT)": "BURHANI MOHALLA (FAHAHIL-KUWAIT)",
  "HAWALLI (KUWAIT)": "HAKIMI MOHALLA (HAWALLI-KUWAIT)",
  "JAHRA (KUWAIT)": "HATEMI MOHALLA (JAHRA-KUWAIT)",
  "KHAITAN (KUWAIT)": "TAHERI MOHALLA (KHAITAN-KUWAIT)",
  KUWAIT: "KUWAIT (MUFADDAL MOHALLA - SALMIYAH)",
  "MIRQAB - KUWAIT": "JAMALI MOHALLA (MIRQAB-KUWAIT)",
  "MOHAMMEDI MOHALLA (KUWAIT)": "MOHAMMEDI MOHALLA (ISTIQLAL-KUWAIT)",
};
async function mastersKuwaitAmmar() {
  const Jamiat = require("../models/Jamiat");
  const Jamaat = require("../models/Jamaat");
  const data = require("../seed/masters-2026-11.json");
  const seed = (jt, name) => data.jamaats.find((r) => r.jamiat === jt && r.name === name) || {};
  const renamed = [];
  const added = [];
  const kw = await Jamiat.findOne({ name: "KUWAIT", ...notDeletedQ() }).lean();
  if (kw) {
    const have = new Map((await Jamaat.find({ jamiat: kw._id }).select("name nameAr").lean()).map((m) => [m.name, m]));
    for (const [from, to] of Object.entries(KUWAIT_RENAME)) {
      const m = have.get(from);
      if (!m || have.has(to)) continue;
      const set = { name: to };
      if (!m.nameAr && seed("KUWAIT", to).nameAr) set.nameAr = seed("KUWAIT", to).nameAr;
      await Jamaat.updateOne({ _id: m._id }, { $set: set });
      have.set(to, m);
      renamed.push({ from, to });
    }
    for (const r of data.jamaats.filter((x) => x.jamiat === "KUWAIT")) {
      if (have.has(r.name) || Object.values(KUWAIT_RENAME).includes(r.name)) continue;
      await Jamaat.create({ jamiat: kw._id, name: r.name, nameAr: r.nameAr, mauzeType: r.mauzeType, isActive: true });
      added.push(`${r.name} (KUWAIT)`);
    }
  }
  const indore = await Jamiat.findOne({ name: "INDORE", ...notDeletedQ() }).lean();
  const ammar = seed("INDORE", "AMMAR NAGAR (INDORE)");
  if (indore && ammar.name && !(await Jamaat.exists({ jamiat: indore._id, name: ammar.name }))) {
    await Jamaat.create({ jamiat: indore._id, name: ammar.name, nameAr: ammar.nameAr, mauzeType: ammar.mauzeType, isActive: true, country: "India", timeZone: "Asia/Kolkata" });
    added.push(`${ammar.name} (INDORE)`);
  }
  console.log(`[migrate] Kuwait / Ammar Nagar: ${renamed.length} renamed, ${added.length} added`);
  if (renamed.length || added.length) {
    await AuditLog.create({
      action: "master_created", username: "system", role: "system",
      target: { type: "masters", id: "masters-2026-11-kuwait", label: "Kuwait Mohallas renamed as in master_check, AMMAR NAGAR (INDORE) added (automatic)" },
      details: { renamed, added },
    });
  }
  return [];
}

const OVERSEAS = ["EAST AFRICA", "FAR EAST", "INDIAN OCEAN", "KHALEEJ", "KUWAIT", "PAKISTAN", "UK", "USA", "YEMEN"];
const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
const isOverseas = (name) => OVERSEAS.some((o) => squash(o) === squash(name));
async function tagIndia() {
  const Jamiat = require("../models/Jamiat");
  const Jamaat = require("../models/Jamaat");
  const india = (await Jamiat.find({}).select("name").lean()).filter((j) => !isOverseas(j.name)).map((j) => j._id);
  const r = await Jamaat.collection.updateMany(
    { jamiat: { $in: india }, $or: [{ country: { $exists: false } }, { country: "" }] },
    { $set: { country: "India", timeZone: "Asia/Kolkata" } }
  );
  if (r.modifiedCount) console.log(`[migrate] ${r.modifiedCount} Jamaat(s) tagged India`);
}

module.exports = { migrate, isOverseas, OVERSEAS };
