// "Data" tab: reading the Super Admin's Excel file, matching rows to Jamiats / Jamaats,
// keeping the JCs' dropdown values across uploads, and writing the Excel download (with colours).
const ExcelJS = require("exceljs");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const { DataRow, toHex, inkFor } = require("../models/DataSheet");
const { InputError } = require("../lib/validate");
const { notDeleted } = require("../lib/softDelete");

const MAX_ROWS = 20000;
const MAX_COLS = 80;
const MAX_CELL = 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Names compared without case, spaces or punctuation ("Badri Mohalla (Mumbai)" = "BADRI MOHALLA - MUMBAI").
const nameKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
// Values compared for "same data": no case, single spaces.
const valKey = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const headKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// "Sr No", "S.No.", "Sl. No", "Serial Number", "#", "No.", "Index"
const SERIAL = /^(s\.?\s*r?|sl|serial|sr)\.?\s*(no|num|number|#)?\.?$|^#$|^no\.?$|^index$/i;
const JAMIAT_HEADS = ["jamiat", "jamiyat", "jamiaat", "jamiatname", "jamiyatname"];
const JAMAAT_HEADS = ["jamaat", "jamat", "jamaath", "jamaatname", "jamatname", "jamaathname"];

/** The text shown for one Excel cell value (dates as "5 Nov 2026", formulas as their result). */
function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const d = `${v.getUTCDate()} ${MONTHS[v.getUTCMonth()]} ${v.getUTCFullYear()}`;
    const hm = v.getUTCHours() * 60 + v.getUTCMinutes();
    return hm ? `${d} ${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}` : d;
  }
  if (typeof v === "number") return String(Math.round(v * 1e9) / 1e9);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text || "").join("").trim();
    if ("result" in v) return cellText(v.result); // formula
    if ("text" in v) return cellText(v.text); // hyperlink
    if ("sharedFormula" in v || "formula" in v) return "";
    return "";
  }
  return String(v).replace(/\r\n?/g, "\n").trim();
}

/** A cell's solid background colour as "#rrggbb" ("" when none or a theme colour). */
function fillOf(cell) {
  const f = cell.fill;
  const argb = f && f.type === "pattern" && f.pattern === "solid" && f.fgColor && f.fgColor.argb;
  return typeof argb === "string" && /^[0-9a-f]{8}$/i.test(argb) ? `#${argb.slice(2).toLowerCase()}` : "";
}

/** Reads the first sheet that has data: { headers: [names], rows: [{ line, cells }] }. */
async function readExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new InputError("This file could not be read. Upload an Excel file saved as .xlsx (in Excel: File › Save As › Excel Workbook).");
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new InputError("The file is empty.");

  // Header = the first row that has anything in it.
  let headRow = null;
  ws.eachRow({ includeEmpty: false }, (row) => { if (!headRow && row.values.some((v) => cellText(v))) headRow = row; });
  if (!headRow) throw new InputError("The file is empty.");

  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    for (let c = row.cellCount; c > width; c--) if (cellText(row.getCell(c).value)) { width = c; break; }
  });
  if (width > MAX_COLS) throw new InputError(`The file has ${width} columns; at most ${MAX_COLS} are allowed.`);

  const seen = new Map();
  const headers = [];
  for (let c = 1; c <= width; c++) {
    let name = cellText(headRow.getCell(c).value).replace(/\s+/g, " ").slice(0, 120) || `Column ${ws.getColumn(c).letter}`;
    const k = name.toLowerCase();
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    if (n > 1) name = `${name} (${n})`;
    headers.push(name);
  }

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, line) => {
    if (line <= headRow.number) return;
    const cells = [];
    const fills = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      cells.push(cellText(cell.value).slice(0, MAX_CELL));
      fills.push(fillOf(cell));
    }
    if (cells.some(Boolean)) rows.push({ line, cells, fills });
  });
  if (!rows.length) throw new InputError("The file has column names but no rows of data.");
  if (rows.length > MAX_ROWS) throw new InputError(`The file has ${rows.length} rows; at most ${MAX_ROWS} are allowed.`);
  return { headers, rows, sheet: ws.name };
}

/** Which column holds the Jamiat / Jamaat (by the header name), or -1. */
function findCol(headers, names) {
  return headers.findIndex((h) => names.includes(headKey(h)));
}

/** Masters for matching: Jamiat by name, Jamaat by Jamiat + name. Deleted ones are not matched. */
async function loadMasters() {
  const [jamiats, jamaats] = await Promise.all([
    Jamiat.find(notDeleted()).select("name").lean(),
    Jamaat.find(notDeleted()).select("name jamiat").lean(),
  ]);
  const jamiatBy = new Map(jamiats.map((j) => [nameKey(j.name), j]));
  const jamaatBy = new Map(jamaats.map((x) => [`${x.jamiat}|${nameKey(x.name)}`, x]));
  return { jamiatBy, jamaatBy };
}

/** The value of a choice written in any case ("active" -> "Active"), or "" when it isn't one. */
const choiceOf = (choices, v) => {
  const k = valKey(v);
  if (!k) return "";
  const c = choices.find((x) => valKey(x.value) === k);
  return c ? c.value : null;
};

/**
 * Works out what an upload would do (used for the preview and for saving).
 *   opts: { jamiatCol, jamaatCol, dropdown: [column names] | undefined }
 *   cfg:  the current DataConfig (previous columns, choices, version)
 * Returns { headers, jamiatCol, jamaatCol, columns, rows, unmatched, stats }.
 */
async function planUpload(file, opts, cfg) {
  const { sheet, headers } = file;
  const raw = file.rows;
  const jamiatCol = Number.isInteger(opts.jamiatCol) && opts.jamiatCol >= 0 && opts.jamiatCol < headers.length ? opts.jamiatCol : findCol(headers, JAMIAT_HEADS);
  const jamaatCol = Number.isInteger(opts.jamaatCol) && opts.jamaatCol >= 0 && opts.jamaatCol < headers.length ? opts.jamaatCol : findCol(headers, JAMAAT_HEADS);
  const choices = cfg.choices || [];

  // A cell coloured like a choice (e.g. a file downloaded from here) has that status.
  const colorOf = new Map(choices.map((c) => [toHex(c.color), c.value]));
  const statusByFill = (r, i) => colorOf.get((r.fills && r.fills[i]) || "") || "";
  // Columns marked as dropdown: as chosen; else the ones marked last time; else the ones with cells
  // coloured like a choice.
  let dropNames;
  if (Array.isArray(opts.dropdown)) dropNames = new Set(opts.dropdown.map((n) => String(n).toLowerCase()));
  else {
    const before = (cfg.columns || []).filter((c) => c.dropdown).map((c) => c.name.toLowerCase());
    dropNames = new Set(before.filter((n) => headers.some((h) => h.toLowerCase() === n)));
    if (!dropNames.size) headers.forEach((h, i) => { if (raw.some((r) => statusByFill(r, i))) dropNames.add(h.toLowerCase()); });
  }
  const columns = headers.map((name, i) => ({ name, dropdown: i !== jamiatCol && i !== jamaatCol && dropNames.has(name.toLowerCase()) }));
  const base = { headers, sheet, jamiatCol, jamaatCol, columns };
  if (jamiatCol < 0 || jamaatCol < 0 || jamiatCol === jamaatCol) {
    return { ...base, rows: [], unmatched: [], stats: null, needCols: true };
  }

  // Match each row to a Jamaat. The Excel values are kept exactly; the status of each dropdown column
  // is separate (`picks`), empty unless the cell is coloured like a choice.
  const { jamiatBy, jamaatBy } = await loadMasters();
  const rows = [];
  const unmatched = [];
  let filePicks = 0;
  for (const r of raw) {
    const jn = r.cells[jamiatCol];
    const mn = r.cells[jamaatCol];
    const j = jamiatBy.get(nameKey(jn));
    const m = j && jamaatBy.get(`${j._id}|${nameKey(mn)}`);
    if (!jn || !mn || !j || !m) {
      unmatched.push({ line: r.line, jamiat: jn, jamaat: mn, reason: !jn ? "No Jamiat" : !mn ? "No Jamaat" : !j ? "Jamiat not found" : "Jamaat not found in this Jamiat" });
      continue;
    }
    const picks = columns.map((c, i) => {
      if (!c.dropdown) return "";
      const p = statusByFill(r, i);
      if (p) filePicks++;
      return p;
    });
    rows.push({ line: r.line, jamiat: j._id, jamaat: m._id, cells: r.cells, picks });
  }

  // Same data as before (any order) keeps its statuses: compare the Jamaat and the columns both files
  // have (serial numbers left out, they change when rows are moved).
  const old = cfg.version ? await DataRow.find({ version: cfg.version }).select("jamaat order cells picks").sort({ order: 1 }).lean() : [];
  const oldCols = (cfg.columns || []).map((c) => ({ name: c.name, dropdown: !!c.dropdown, k: c.name.toLowerCase() }));
  const shared = columns
    .map((c, i) => ({ i, k: c.name.toLowerCase() }))
    .filter((c) => c.i !== jamiatCol && c.i !== jamaatCol && !SERIAL.test(columns[c.i].name.trim()))
    .map((c) => ({ ...c, oi: oldCols.findIndex((o) => o.k === c.k) }))
    .filter((c) => c.oi >= 0);
  const sigNew = (r) => [String(r.jamaat), ...shared.map((c) => valKey(r.cells[c.i]))].join("\u0001");
  const sigOld = (r) => [String(r.jamaat), ...shared.map((c) => valKey(r.cells[c.oi]))].join("\u0001");
  const pool = new Map();
  for (const r of old) {
    const k = sigOld(r);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(r);
  }
  let kept = 0;
  let keptPicks = 0;
  for (const r of rows) {
    const q = pool.get(sigNew(r));
    const prev = q && q.shift();
    if (!prev) continue;
    kept++;
    columns.forEach((c, i) => {
      if (!c.dropdown) return;
      const oi = oldCols.findIndex((o) => o.k === c.name.toLowerCase() && o.dropdown);
      const was = oi >= 0 && prev.picks ? choiceOf(choices, prev.picks[oi]) : "";
      if (was) { r.picks[i] = was; keptPicks++; } // the status chosen on the portal wins
    });
  }
  const removed = [...pool.values()].reduce((n, q) => n + q.length, 0);

  return {
    ...base,
    rows,
    unmatched,
    stats: {
      read: raw.length,
      matched: rows.length,
      unmatched: unmatched.length,
      jamaats: new Set(rows.map((r) => String(r.jamaat))).size,
      jamiats: new Set(rows.map((r) => String(r.jamiat))).size,
      hadData: !!cfg.version,
      kept,
      added: rows.length - kept,
      removed,
      keptPicks,
      filePicks,
      compared: shared.map((c) => columns[c.i].name),
    },
  };
}

// ---------- Excel download ----------
const argb = (hex) => `FF${toHex(hex).slice(1).toUpperCase()}`;

/**
 * Builds the download: the uploaded columns exactly as uploaded; in a column with a status, the cell's
 * background is the status colour (no colour = not set). Uploading this file again reads the colours back.
 */
async function buildWorkbook(cfg, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Umoor Sehhat";
  wb.created = new Date();
  const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  const choices = cfg.choices || [];
  const cols = cfg.columns;

  ws.columns = cols.map((c, i) => {
    const longest = rows.reduce((n, r) => Math.max(n, String(r.cells[i] || "").length), c.name.length);
    return { header: c.name, key: `c${i}`, width: Math.min(50, Math.max(10, longest + 2)) };
  });
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FF1F2937" } };
  head.alignment = { vertical: "middle" };
  head.height = 20;
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF1F4" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFC9CED6" } } };
  });

  rows.forEach((r) => {
    const row = ws.addRow(cols.map((_, i) => r.cells[i] || ""));
    cols.forEach((c, i) => {
      if (!c.dropdown) return;
      const ch = choices.find((x) => x.value === (r.picks && r.picks[i]));
      if (!ch) return;
      const cell = row.getCell(i + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(ch.color) } };
      cell.font = { color: { argb: argb(inkFor(ch.color)) } };
    });
  });

  // A small key of the colours, on its own sheet.
  if (cols.some((c) => c.dropdown) && choices.length) {
    const key = wb.addWorksheet("Colours");
    key.columns = [{ header: "Status", key: "s", width: 24 }];
    key.getRow(1).font = { bold: true };
    for (const ch of choices) {
      const cell = key.addRow([ch.value]).getCell(1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(ch.color) } };
      cell.font = { color: { argb: argb(inkFor(ch.color)) }, bold: true };
    }
  }
  if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return wb.xlsx.writeBuffer();
}

module.exports = { readExcel, planUpload, buildWorkbook, cellText, choiceOf, nameKey, valKey, MAX_ROWS };
