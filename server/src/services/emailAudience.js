// Who an email from "Send email" goes to. Only people who are in the portal (active users) can be emailed.
//   to = {
//     roles:   ["jamaat_coordinator", "jc", "saheb", "superadmin"]   whole groups
//     jamiats: [names], jamaats: [{ jamiat, jamaat }]                  narrow the Jamaat Coordinators and JCs
//                                                                      (Sahebs / Super Admins are not tied to places)
//     users:   [user ids]                                              chosen one by one
//     emails:  ["a@gmail.com"]                                         typed; must be a portal user's Gmail
//   }
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const { notDeleted } = require("../lib/softDelete");
const { InputError } = require("../lib/validate");
const F = require("./forms");

const ROLES = { jamaat_coordinator: "Jamaat Coordinators", jc: "JCs", saheb: "Sahebs", superadmin: "Super Admins" };
const ROLE_ONE = { jamaat_coordinator: "Jamaat Coordinator", jc: "JC", saheb: "Saheb", superadmin: "Super Admin" };
const MAX = 5000;

const strList = (v, max = 2000) => (Array.isArray(v) ? v : []).map((x) => String(x == null ? "" : x).trim()).filter(Boolean).slice(0, max);

/** Everyone who can be emailed (active portal users with a Gmail), with their places by name. */
async function people() {
  const [users, jts, jms] = await Promise.all([
    User.find({ isActive: true, email: { $nin: [null, ""] }, ...notDeleted() }).select("name email role jamaat jamaats jamiats").lean(),
    Jamiat.find({ isActive: true, ...notDeleted() }).select("name").lean(),
    Jamaat.find({ isActive: true, ...notDeleted() }).select("name jamiat").lean(),
  ]);
  const jtName = new Map(jts.map((j) => [String(j._id), j.name]));
  const jmOf = new Map(jms.map((j) => [String(j._id), { name: j.name, jamiat: jtName.get(String(j.jamiat)) || "" }]));
  const list = users.map((u) => {
    let places = [];
    if (u.role === "jamaat_coordinator" && u.jamaat && jmOf.has(String(u.jamaat))) places = [jmOf.get(String(u.jamaat))];
    if (u.role === "jc") {
      const allowed = new Set((u.jamiats || []).map((x) => jtName.get(String(x))).filter(Boolean));
      places = (u.jamaats || []).map((x) => jmOf.get(String(x))).filter((p) => p && allowed.has(p.jamiat));
    }
    return { id: String(u._id), name: u.name || "", email: u.email, emailKey: F.emailKeyOf(u.email), role: u.role, places };
  });
  const byJamiat = {};
  for (const j of jms) { const n = jtName.get(String(j.jamiat)); if (n) (byJamiat[n] = byJamiat[n] || []).push(j.name); }
  const placesList = Object.keys(byJamiat).sort().map((k) => ({ jamiat: k, jamaats: byJamiat[k].sort() }));
  return { list, places: placesList };
}

/** A short description of a place list for the table / history. */
const placeText = (p) => (p.places.length === 1 ? `${p.places[0].jamaat || p.places[0].name}` : p.places.length > 1 ? `${p.places.length} Jamaats` : "");

/**
 * Resolve `to` -> recipients (unique people). Throws (400) for typed emails that aren't portal users.
 * @returns {Promise<{ recipients: object[], audience: string, unknown: string[] }>}
 */
async function resolve(to = {}, { strict = true } = {}) {
  const { list } = await people();
  const roles = strList(to.roles, 10).filter((r) => ROLES[r]);
  const jamiats = new Set(strList(to.jamiats));
  const jamaats = (Array.isArray(to.jamaats) ? to.jamaats : []).slice(0, 5000)
    .map((x) => ({ jamiat: String((x && x.jamiat) || "").trim(), jamaat: String((x && x.jamaat) || "").trim() })).filter((x) => x.jamiat && x.jamaat);
  const jmKey = new Set(jamaats.map((x) => `${x.jamiat}\u0000${x.jamaat}`));
  const placed = jamiats.size > 0 || jmKey.size > 0;
  const inPlace = (p) => jmKey.has(`${p.jamiat}\u0000${p.name}`) || (jamiats.has(p.jamiat) && !jamaats.some((x) => x.jamiat === p.jamiat));
  const ids = new Set(strList(to.users, MAX));
  const typed = strList(to.emails, 500).map((e) => e.toLowerCase());
  const byKey = new Map(list.map((p) => [p.emailKey, p]));

  const chosen = new Map();
  const add = (p) => { if (!chosen.has(p.id)) chosen.set(p.id, p); };
  for (const p of list) {
    if (roles.includes(p.role)) {
      const tied = p.role === "jamaat_coordinator" || p.role === "jc";
      if (!placed || !tied || p.places.some(inPlace)) add(p);
    }
    if (ids.has(p.id)) add(p);
  }
  const unknown = [];
  for (const e of typed) {
    const p = byKey.get(F.emailKeyOf(e));
    if (p) add(p); else unknown.push(e);
  }
  if (strict && unknown.length) throw new InputError(`${unknown.length === 1 ? "This email isn't" : "These emails aren't"} in the portal: ${unknown.join(", ")}. Only portal users can be emailed.`);
  const recipients = [...chosen.values()].sort((a, b) => a.role.localeCompare(b.role) || (a.name || a.email).localeCompare(b.name || b.email));
  if (recipients.length > MAX) throw new InputError(`That is ${recipients.length} people; one email can go to at most ${MAX}.`);

  // In words, for the history.
  const parts = [];
  if (roles.length) {
    const where = placed ? ` of ${[...jamiats].concat(jamaats.filter((x) => !jamiats.has(x.jamiat)).map((x) => x.jamaat)).slice(0, 4).join(", ")}${jamiats.size + jamaats.length > 4 ? "…" : ""}` : "";
    parts.push(roles.map((r) => `All ${ROLES[r]}${(r === "jamaat_coordinator" || r === "jc") ? where : ""}`).join(", "));
  }
  const extra = ids.size + typed.length - unknown.length;
  if (extra) parts.push(`${roles.length ? "+ " : ""}${extra} chosen ${extra === 1 ? "person" : "people"}`);
  return {
    recipients: recipients.map((p) => ({ user: p.id, email: p.email, name: p.name, role: p.role, place: p.places.length === 1 ? `${p.places[0].name} (${p.places[0].jamiat})` : p.places.length ? `${p.places.length} Jamaats` : "" })),
    audience: parts.join(" ") || "Chosen people",
    unknown,
  };
}

module.exports = { people, resolve, ROLES, ROLE_ONE, placeText, MAX };
