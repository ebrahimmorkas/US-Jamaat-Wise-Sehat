// JC access (which Jamiats / Jamaats a JC is assigned).
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const User = require("../models/User");
const { InputError, isId } = require("../lib/validate");

const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))];

/**
 * Checks an assignment from the Super Admin form.
 *  - at least one Jamiat; every id must exist
 *  - every Jamaat must belong to one of the chosen Jamiats
 *  - a chosen Jamiat that has active Jamaats needs at least one of them chosen
 * Returns { jamiats: [ids], jamaats: [ids] }.
 */
async function parseAssignment(body) {
  const jamiatIds = ids(body.jamiats);
  const jamaatIds = ids(body.jamaats);
  if (!jamiatIds.length) throw new InputError("Choose at least one Jamiat.");
  if (![...jamiatIds, ...jamaatIds].every(isId)) throw new InputError("Some Jamiats or Jamaats are not valid. Reload the page.");

  const jamiats = await Jamiat.find({ _id: { $in: jamiatIds } }).select("name").lean();
  if (jamiats.length !== jamiatIds.length) throw new InputError("Some Jamiats no longer exist. Reload the page.");
  const jamaats = await Jamaat.find({ _id: { $in: jamaatIds } }).select("jamiat").lean();
  if (jamaats.length !== jamaatIds.length) throw new InputError("Some Jamaats no longer exist. Reload the page.");
  if (jamaats.some((jm) => !jamiatIds.includes(String(jm.jamiat)))) {
    throw new InputError("A chosen Jamaat is not inside the chosen Jamiats. Reload the page.");
  }

  const withActive = await Jamaat.distinct("jamiat", { jamiat: { $in: jamiatIds }, isActive: true });
  const covered = new Set(jamaats.map((jm) => String(jm.jamiat)));
  const empty = jamiats.filter((j) => withActive.some((id) => String(id) === String(j._id)) && !covered.has(String(j._id)));
  if (empty.length) throw new InputError(`Choose at least one Jamaat in ${empty.map((j) => j.name).join(", ")}.`);

  return { jamiats: jamiatIds, jamaats: jamaatIds };
}

/**
 * JCs who have "all access" just before a new Jamiat / Jamaat was added:
 *  - new Jamiat: JCs assigned every other active Jamiat
 *  - new Jamaat: JCs assigned its Jamiat and every other active Jamaat of that Jamiat
 * Returns the MongoDB filter, or null when nobody can qualify.
 */
async function allAccessFilter(type, id) {
  if (type === "jamiat") {
    const others = (await Jamiat.find({ isActive: true, _id: { $ne: id } }).select("_id").lean()).map((j) => j._id);
    if (!others.length) return null;
    return { role: "jc", jamiats: { $all: others, $ne: id } };
  }
  if (type === "jamaat") {
    const jm = await Jamaat.findById(id).select("jamiat").lean();
    if (!jm) return null;
    const others = (await Jamaat.find({ jamiat: jm.jamiat, isActive: true, _id: { $ne: id } }).select("_id").lean()).map((x) => x._id);
    return { role: "jc", jamiats: jm.jamiat, jamaats: others.length ? { $all: others, $ne: id } : { $ne: id } };
  }
  return null;
}

async function countAllAccess(type, id) {
  const filter = await allAccessFilter(type, id);
  return filter ? User.countDocuments(filter) : 0;
}

async function grantToAllAccess(type, id) {
  const filter = await allAccessFilter(type, id);
  if (!filter) return 0;
  const field = type === "jamiat" ? "jamiats" : "jamaats";
  return (await User.updateMany(filter, { $addToSet: { [field]: id } })).modifiedCount;
}

/** When a Jamiat / Jamaat is deleted, take it out of every JC's access. */
async function removeFromAccess(type, id) {
  const field = type === "jamiat" ? "jamiats" : "jamaats";
  await User.updateMany({ [field]: id }, { $pull: { [field]: id } });
}

/**
 * Audit trail for an assignment change: counts before/after and the names added / removed.
 * before / after = { jamiats: [ids], jamaats: [ids] } (missing = empty).
 */
async function accessChanges(before, after) {
  const out = [];
  const listNames = (names) => (names.length > 40 ? [...names.slice(0, 40), `… and ${names.length - 40} more`] : names);
  for (const [field, Model, label] of [["jamiats", Jamiat, "Jamiats"], ["jamaats", Jamaat, "Jamaats"]]) {
    const a = ((before && before[field]) || []).map(String);
    const b = ((after && after[field]) || []).map(String);
    const added = b.filter((id) => !a.includes(id));
    const removed = a.filter((id) => !b.includes(id));
    if (!added.length && !removed.length) continue;
    const docs = await Model.find({ _id: { $in: [...added, ...removed] } }).select("name").lean();
    const nameOf = new Map(docs.map((d) => [String(d._id), d.name]));
    out.push({ field, label: `${label} (count)`, from: a.length, to: b.length });
    if (added.length) out.push({ field: `${field}.added`, label: `${label} added`, from: null, to: listNames(added.map((id) => nameOf.get(id) || id)) });
    if (removed.length) out.push({ field: `${field}.removed`, label: `${label} removed`, from: listNames(removed.map((id) => nameOf.get(id) || id)), to: null });
  }
  return out;
}

module.exports = { parseAssignment, countAllAccess, grantToAllAccess, removeFromAccess, accessChanges };
