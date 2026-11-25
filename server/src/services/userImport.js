// Bulk upload of users from Excel (Super Admin).
// The file: a sheet "Users" (else the first sheet) with a header row and these columns (any order, extra columns ignored):
//   Gmail        required
//   Role         required: Super Admin, Saheb, JC, Jamaat Coordinator, Media
//   Jamiats      JC: Jamiat names, or "All"; Jamaat Coordinator: optional, the Jamaat's Jamiat
//   Jamaats      JC: Jamaat names inside those Jamiats; empty or "All" = every active Jamaat of those Jamiats
//                Jamaat Coordinator: the one Jamaat
//   Form tester  Yes / No (empty = No)
// Lists: names separated by ";" or new lines (some Jamaat names have commas). Names are matched without caring
// about capitals or extra spaces. A Jamaat can also be written "Jamiat / Jamaat".
// Every row is checked first (preview); adding adds only the rows that are OK.
const ExcelJS = require("exceljs");
const User = require("../models/User");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const { parseGmail } = require("../lib/gmail");
const { notDeleted } = require("../lib/softDelete");
const { InputError } = require("../lib/validate");

const MAX_ROWS = 2000;
const ROLE_LABELS = { superadmin: "Super Admin", saheb: "Saheb", jc: "JC", jamaat_coordinator: "Jamaat Coordinator", media: "Media" };
const ROLE_WORDS = {
  superadmin: "superadmin", admin: "superadmin", saheb: "saheb", sahebo: "saheb",
  jc: "jc", jamiatcoordinator: "jc", jamaatcoordinator: "jamaat_coordinator", coordinator: "jamaat_coordinator", media: "media",
};
const HEADERS = ["Gmail", "Role", "Jamiats", "Jamaats", "Form tester"];

const key = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const list = (s) => String(s || "").split(/[;\n\r]+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
const isAll = (items) => items.length === 1 && key(items[0]) === "all";

/** The text of a cell (links, formulas and rich text included). */
function cellText(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text !== undefined) return typeof v.text === "string" ? v.text : (v.text.richText || []).map((r) => r.text).join("");
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result !== undefined) return String(v.result);
  }
  return String(cell.text != null ? cell.text : v);
}

/** Reads the file: [{ row, email, role, jamiats, jamaats, tester }] (raw text). */
async function readFile(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch {
    throw new InputError("This file couldn't be read. Save it as an Excel workbook (.xlsx) and try again.");
  }
  const ws = wb.worksheets.find((w) => key(w.name) === "users") || wb.worksheets[0];
  if (!ws) throw new InputError("The file has no sheets.");
  // Header row: the first of the top 10 rows that has a "Gmail" (or "Email") column.
  let head = 0;
  const cols = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !head; r++) {
    const row = ws.getRow(r);
    const found = {};
    row.eachCell((c, n) => {
      const h = key(cellText(c)).replace(/[^a-z ]/g, "");
      if (/^(gmail|email|gmail address|email address|e mail)$/.test(h)) found.email = n;
      else if (/^roles?$/.test(h)) found.role = n;
      else if (/^jamiat/.test(h)) found.jamiats = n;
      else if (/^jamaat/.test(h)) found.jamaats = n;
      else if (/tester/.test(h)) found.tester = n;
    });
    if (found.email) { head = r; Object.assign(cols, found); }
  }
  if (!head) throw new InputError(`No "Gmail" column was found. Use the sample file: its first row is ${HEADERS.join(", ")}.`);
  if (!cols.role) throw new InputError("No \"Role\" column was found. Use the sample file.");
  const rows = [];
  for (let r = head + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c) => (c ? cellText(row.getCell(c)).trim() : "");
    const item = { row: r, email: get(cols.email), role: get(cols.role), jamiats: get(cols.jamiats), jamaats: get(cols.jamaats), tester: get(cols.tester) };
    if (!item.email && !item.role && !item.jamiats && !item.jamaats) continue; // empty row
    rows.push(item);
  }
  if (!rows.length) throw new InputError("The file has no users (the rows under the header are empty).");
  if (rows.length > MAX_ROWS) throw new InputError(`The file has ${rows.length} users. Upload at most ${MAX_ROWS} at a time.`);
  return rows;
}

/** Jamiats / Jamaats that can be assigned (not deleted; "All" = only the active ones). */
async function places() {
  const [jts, jms] = await Promise.all([
    Jamiat.find(notDeleted()).select("name isActive").lean(),
    Jamaat.find(notDeleted()).select("name jamiat isActive").lean(),
  ]);
  const jtById = new Map(jts.map((j) => [String(j._id), j]));
  const jtByName = new Map();
  for (const j of jts) { const k = key(j.name); if (!jtByName.has(k)) jtByName.set(k, []); jtByName.get(k).push(j); }
  const jmByName = new Map();
  for (const j of jms) { const k = key(j.name); if (!jmByName.has(k)) jmByName.set(k, []); jmByName.get(k).push(j); }
  const activeIn = new Map(); // jamiat id -> active Jamaats
  for (const j of jms) {
    if (!j.isActive) continue;
    const k = String(j.jamiat);
    if (!activeIn.has(k)) activeIn.set(k, []);
    activeIn.get(k).push(j);
  }
  return { jts, jms, jtById, jtByName, jmByName, activeIn };
}

/** One Jamaat by name (or "Jamiat / Jamaat"), optionally only inside some Jamiats. Returns [jamaat, error]. */
function findJamaat(P, text, insideIds) {
  let name = text;
  let jtFilter = insideIds;
  const slash = text.lastIndexOf(" / ");
  if (!P.jmByName.has(key(text)) && slash > 0) {
    const jt = P.jtByName.get(key(text.slice(0, slash)));
    if (!jt) return [null, `Jamiat "${text.slice(0, slash)}" not found`];
    jtFilter = new Set(jt.map((j) => String(j._id)));
    name = text.slice(slash + 3);
  }
  let found = P.jmByName.get(key(name)) || [];
  if (!found.length) return [null, `Jamaat "${name}" not found`];
  if (jtFilter) found = found.filter((j) => jtFilter.has(String(j.jamiat)));
  if (!found.length) return [null, `Jamaat "${name}" is not in ${insideIds && jtFilter === insideIds ? "the Jamiats of this row" : "that Jamiat"}`];
  if (found.length > 1) {
    const names = found.map((j) => (P.jtById.get(String(j.jamiat)) || {}).name).join(" and ");
    return [null, `there are Jamaats called "${name}" in ${names}: write it as "Jamiat / ${name}"`];
  }
  return [found[0], ""];
}

/**
 * Checks every row. Returns [{ row, email, role, roleLabel, access, tester, ok, error, note, data }]:
 * data = what to save (only when ok).
 */
async function plan(rows) {
  const P = await places();
  const existing = await User.find({ ...notDeleted() }).select("+emailKey email role jamaat").lean();
  const taken = new Map(existing.filter((u) => u.emailKey).map((u) => [u.emailKey, u]));
  const coordOf = new Map(existing.filter((u) => u.role === "jamaat_coordinator" && u.jamaat).map((u) => [String(u.jamaat), u.email]));
  const inFile = new Map(); // emailKey -> row
  const coordInFile = new Map(); // jamaat id -> row
  const out = [];
  for (const r of rows) {
    const res = { row: r.row, email: r.email.toLowerCase(), role: "", roleLabel: r.role, access: "", tester: false, ok: false, error: "", note: "" };
    const fail = (msg) => { res.error = msg; out.push(res); };
    const g = parseGmail(r.email);
    if (g.error) { fail(r.email ? g.error : "Gmail is empty."); continue; }
    res.email = g.email;
    const role = ROLE_WORDS[key(r.role).replace(/[^a-z]/g, "")];
    if (!role) { fail(r.role ? `Unknown role "${r.role}". Use Super Admin, Saheb, JC, Jamaat Coordinator or Media.` : "Role is empty."); continue; }
    res.role = role;
    res.roleLabel = ROLE_LABELS[role];
    const t = key(r.tester);
    if (t && !["yes", "no", "y", "n", "true", "false", "1", "0"].includes(t)) { fail(`Form tester must be Yes or No (not "${r.tester}").`); continue; }
    res.tester = ["yes", "y", "true", "1"].includes(t);
    if (taken.has(g.emailKey)) { fail(`Already added (${taken.get(g.emailKey).email}).`); continue; }
    if (inFile.has(g.emailKey)) { fail(`Same Gmail as row ${inFile.get(g.emailKey)}.`); continue; }

    const data = { role, email: g.email, emailKey: g.emailKey, isTester: res.tester };
    const jtItems = list(r.jamiats);
    const jmItems = list(r.jamaats);
    if (role === "jc") {
      if (!jtItems.length) { fail("A JC needs Jamiats (names, or All)."); continue; }
      let jts = [];
      let bad = "";
      if (isAll(jtItems)) jts = P.jts.filter((j) => j.isActive);
      else {
        for (const n of jtItems) {
          const m = P.jtByName.get(key(n));
          if (!m) { bad = `Jamiat "${n}" not found.`; break; }
          jts.push(m[0]);
        }
      }
      if (bad) { fail(bad); continue; }
      jts = [...new Map(jts.map((j) => [String(j._id), j])).values()];
      if (!jts.length) { fail("There are no active Jamiats."); continue; }
      const jtIds = new Set(jts.map((j) => String(j._id)));
      let jms = [];
      if (!jmItems.length || isAll(jmItems)) jms = jts.flatMap((j) => P.activeIn.get(String(j._id)) || []);
      else {
        for (const n of jmItems) {
          const [jm, err] = findJamaat(P, n, jtIds);
          if (err) { bad = `${err[0].toUpperCase()}${err.slice(1)}.`; break; }
          jms.push(jm);
        }
        if (!bad) {
          jms = [...new Map(jms.map((j) => [String(j._id), j])).values()];
          const covered = new Set(jms.map((j) => String(j.jamiat)));
          const empty = jts.filter((j) => (P.activeIn.get(String(j._id)) || []).length && !covered.has(String(j._id)));
          if (empty.length) bad = `No Jamaat chosen in ${empty.map((j) => j.name).join(", ")}. List at least one of its Jamaats, or leave Jamaats empty for all of them.`;
        }
      }
      if (bad) { fail(bad); continue; }
      data.jamiats = jts.map((j) => j._id);
      data.jamaats = jms.map((j) => j._id);
      res.access = `${jts.length === 1 ? jts[0].name : `${jts.length} Jamiats`} · ${jms.length} Jamaat${jms.length === 1 ? "" : "s"}`;
    } else if (role === "jamaat_coordinator") {
      if (jmItems.length !== 1) { fail(jmItems.length ? "A Jamaat Coordinator is for one Jamaat only." : "A Jamaat Coordinator needs the Jamaat."); continue; }
      let inside = null;
      if (jtItems.length) {
        const m = jtItems.length === 1 ? P.jtByName.get(key(jtItems[0])) : null;
        if (!m) { fail(jtItems.length === 1 ? `Jamiat "${jtItems[0]}" not found.` : "Write one Jamiat for a Jamaat Coordinator."); continue; }
        inside = new Set(m.map((j) => String(j._id)));
      }
      const [jm, err] = findJamaat(P, jmItems[0], inside);
      if (err) { fail(`${err[0].toUpperCase()}${err.slice(1)}.`); continue; }
      if (coordOf.has(String(jm._id))) { fail(`${jm.name} already has a Jamaat Coordinator (${coordOf.get(String(jm._id))}).`); continue; }
      if (coordInFile.has(String(jm._id))) { fail(`${jm.name} is also given to row ${coordInFile.get(String(jm._id))}. A Jamaat has only one Coordinator.`); continue; }
      data.jamaat = jm._id;
      res.access = `${jm.name} · ${(P.jtById.get(String(jm.jamiat)) || {}).name || ""}`;
      if (!jm.isActive) res.note = "This Jamaat is inactive.";
      coordInFile.set(String(jm._id), r.row);
    } else if (jtItems.length || jmItems.length) {
      res.note = `Jamiats / Jamaats are only for JC and Jamaat Coordinator, so they are ignored for ${ROLE_LABELS[role]}.`;
    }
    inFile.set(g.emailKey, r.row);
    res.ok = true;
    res.data = data;
    out.push(res);
  }
  return out;
}

/** The sample file: "Users" (to fill), "How to fill" (rules + examples), "Jamiats and Jamaats" (names to copy). */
async function sampleBook() {
  const P = await places();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Users", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Gmail", key: "email", width: 34 }, { header: "Role", key: "role", width: 22 },
    { header: "Jamiats", key: "jamiats", width: 36 }, { header: "Jamaats", key: "jamaats", width: 48 }, { header: "Form tester", key: "tester", width: 13 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5C3F" } }; });
  for (let r = 2; r <= 501; r++) {
    ws.getCell(`B${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Super Admin,Saheb,JC,Jamaat Coordinator,Media"'], showErrorMessage: true, errorTitle: "Role", error: "Choose a role from the list." };
    ws.getCell(`E${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Yes,No"'] };
    ws.getCell(`C${r}`).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(`D${r}`).alignment = { wrapText: true, vertical: "top" };
  }

  // Examples use real names (so they can be checked), but the Gmails are made up.
  const jts = P.jts.filter((j) => j.isActive && (P.activeIn.get(String(j._id)) || []).length).sort((a, b) => a.name.localeCompare(b.name));
  const jt1 = jts[0], jt2 = jts[1] || jts[0];
  const jm = (jt, i) => ((P.activeIn.get(String(jt._id)) || []).slice().sort((a, b) => a.name.localeCompare(b.name))[i] || {}).name || "";
  const how = wb.addWorksheet("How to fill");
  const lines = [
    ["Bulk upload of users", ""],
    ["", "Fill the sheet \"Users\": one row per person, then upload this file on the Users page (Add many users from Excel)."],
    ["", "You see every row checked first. Only the rows that are OK are added; the others are listed with the reason."],
    ["", ""],
    ["Gmail", "Required. The person's Gmail address (they sign in with this Google account)."],
    ["Role", "Required. One of: Super Admin, Saheb, JC, Jamaat Coordinator, Media."],
    ["Jamiats", "JC: the Jamiats they work for, separated by ; (semicolon) or one per line. \"All\" = every active Jamiat."],
    ["", "Jamaat Coordinator: optional, the Jamiat of their Jamaat (only needed when two Jamaats have the same name)."],
    ["", "Other roles: leave empty."],
    ["Jamaats", "JC: the Jamaats they work for, inside those Jamiats, separated by ; or one per line."],
    ["", "Leave empty (or write All) for every active Jamaat of those Jamiats. Use ; not commas: some Jamaat names have commas."],
    ["", "Jamaat Coordinator: their one Jamaat (a Jamaat has only one Coordinator)."],
    ["Form tester", "Optional. Yes = can fill forms while they are in Testing. Empty = No."],
    ["", ""],
    ["Names", "Write Jamiat and Jamaat names as on the sheet \"Jamiats and Jamaats\" (capitals and extra spaces don't matter)."],
    ["", ""],
    ["Examples", "(made-up Gmails; don't copy these rows into \"Users\")"],
  ];
  lines.forEach((l) => how.addRow(l));
  how.getRow(1).font = { bold: true, size: 14 };
  [5, 6, 7, 10, 13, 15, 17].forEach((r) => { how.getCell(`A${r}`).font = { bold: true }; });
  const exHead = how.addRow(HEADERS);
  exHead.font = { bold: true };
  const exRows = [
    ["example.jc@gmail.com", "JC", jt1 ? `${jt1.name}; ${jt2.name}` : "", "", "No"],
    ["example.jc2@gmail.com", "JC", jt1 ? jt1.name : "", jt1 ? [jm(jt1, 0), jm(jt1, 1)].filter(Boolean).join("; ") : "", ""],
    ["example.jc3@gmail.com", "JC", "All", "", ""],
    ["example.coordinator@gmail.com", "Jamaat Coordinator", "", jt1 ? jm(jt1, 2) || jm(jt1, 0) : "", ""],
    ["example.saheb@gmail.com", "Saheb", "", "", ""],
    ["example.media@gmail.com", "Media", "", "", "Yes"],
    ["example.admin@gmail.com", "Super Admin", "", "", ""],
  ];
  const exStart = how.rowCount + 1;
  exRows.forEach((r) => how.addRow(r));
  [32, 22, 34, 44, 13].forEach((w, i) => { how.getColumn(i + 1).width = w; });
  for (let r = exStart; r < exStart + exRows.length; r++) how.getRow(r).alignment = { vertical: "top", wrapText: true };
  // The rule texts are long: let them run across the columns.
  for (let r = 1; r <= lines.length; r++) {
    if (how.getCell(`B${r}`).value) how.mergeCells(`B${r}:E${r}`);
  }

  const names = wb.addWorksheet("Jamiats and Jamaats", { views: [{ state: "frozen", ySplit: 1 }] });
  names.columns = [{ header: "Jamiat", key: "jt", width: 30 }, { header: "Jamaat", key: "jm", width: 50 }];
  names.getRow(1).font = { bold: true };
  for (const j of jts) {
    for (const m of (P.activeIn.get(String(j._id)) || []).slice().sort((a, b) => a.name.localeCompare(b.name))) names.addRow({ jt: j.name, jm: m.name });
  }
  return wb;
}

module.exports = { readFile, plan, sampleBook, MAX_ROWS, ROLE_LABELS };
