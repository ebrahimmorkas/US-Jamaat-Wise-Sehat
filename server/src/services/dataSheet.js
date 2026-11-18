// "Data" tab: reading the Super Admin's Excel file, matching rows to Jamiats / Jamaats,
// keeping the JCs' dropdown values across uploads, and writing the Excel download (with colours).
const ExcelJS = require("exceljs");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const { DataRow, PALETTE } = require("../models/DataSheet");
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
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value).slice(0, MAX_CELL));
    if (cells.some(Boolean)) rows.push({ line, cells });
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
  const { headers, rows: raw, sheet } = file;
  const jamiatCol = Number.isInteger(opts.jamiatCol) && opts.jamiatCol >= 0 && opts.jamiatCol < headers.length ? opts.jamiatCol : findCol(headers, JAMIAT_HEADS);
  const jamaatCol = Number.isInteger(opts.jamaatCol) && opts.jamaatCol >= 0 && opts.jamaatCol < headers.length ? opts.jamaatCol : findCol(headers, JAMAAT_HEADS);
  const choices = cfg.choices || [];

  // Dropdown columns: as chosen; else the ones that were dropdowns last time; else columns whose values are all choices.
  let dropNames;
  if (Array.isArray(opts.dropdown)) dropNames = new Set(opts.dropdown.map((n) => String(n).toLowerCase()));
  else {
    const before = (cfg.columns || []).filter((c) => c.dropdown).map((c) => c.name.toLowerCase());
    dropNames = new Set(before.filter((n) => headers.some((h) => h.toLowerCase() === n)));
    if (!dropNames.size) {
      headers.forEach((h, i) => {
        const vals = raw.map((r) => r.cells[i]).filter(Boolean);
        if (vals.length && vals.every((v) => choiceOf(choices, v))) dropNames.add(h.toLowerCase());
      });
    }
  }
  const columns = headers.map((name, i) => ({ name, dropdown: i !== jamiatCol && i !== jamaatCol && dropNames.has(name.toLowerCase()) }));
  const base = { headers, sheet, jamiatCol, jamaatCol, columns };
  if (jamiatCol < 0 || jamaatCol < 0 || jamiatCol === jamaatCol) {
    return { ...base, rows: [], unmatched: [], stats: null, needCols: true };
  }

  // Match each row to a Jamaat.
  const { jamiatBy, jamaatBy } = await loadMasters();
  const rows = [];
  const unmatched = [];
  let badPicks = 0;
  const badExamples = new Set();
  for (const r of raw) {
    const jn = r.cells[jamiatCol];
    const mn = r.cells[jamaatCol];
    const j = jamiatBy.get(nameKey(jn));
    const m = j && jamaatBy.get(`${j._id}|${nameKey(mn)}`);
    if (!jn || !mn || !j || !m) {
      unmatched.push({ line: r.line, jamiat: jn, jamaat: mn, reason: !jn ? "No Jamiat" : !mn ? "No Jamaat" : !j ? "Jamiat not found" : "Jamaat not found in this Jamiat" });
      continue;
    }
    const cells = r.cells.map((v, i) => {
      if (!columns[i].dropdown) return v;
      const c = choiceOf(choices, v);
      // A value from the file that isn't a choice is kept as it is (shown without colour; the JC can change it).
      if (c === null) { badPicks++; if (badExamples.size < 5) badExamples.add(v); return v; }
      return c;
    });
    rows.push({ line: r.line, jamiat: j._id, jamaat: m._id, cells });
  }

  // Same data as before (any order) keeps its dropdown values: compare the Jamaat and the non-dropdown
  // columns that both files have.
  const old = cfg.version ? await DataRow.find({ version: cfg.version }).select("jamaat order cells").sort({ order: 1 }).lean() : [];
  const oldCols = (cfg.columns || []).map((c) => ({ name: c.name, dropdown: !!c.dropdown, k: c.name.toLowerCase() }));
  const shared = columns
    .map((c, i) => ({ i, k: c.name.toLowerCase(), dropdown: c.dropdown }))
    // Serial numbers change when rows are moved, so they don't decide "same row".
    .filter((c) => !c.dropdown && c.i !== jamiatCol && c.i !== jamaatCol && !SERIAL.test(columns[c.i].name.trim()))
    .map((c) => ({ ...c, oi: oldCols.findIndex((o) => o.k === c.k && !o.dropdown) }))
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
      const was = oi >= 0 ? prev.cells[oi] : "";
      if (was && choiceOf(choices, was)) {
        if (r.cells[i] !== was) keptPicks++;
        r.cells[i] = choiceOf(choices, was);
      }
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
      badPicks,
      badExamples: [...badExamples],
      compared: shared.map((c) => columns[c.i].name),
    },
  };
}

// ---------- Excel download ----------
const argb = (hex) => `FF${hex.replace("#", "").toUpperCase()}`;
const listFormula = (choices) => `"${choices.map((c) => c.value).join(",")}"`;

/**
 * Builds the download: the uploaded columns, the rows (Jamiat by Jamiat), dropdown columns as real Excel
 * dropdowns with the same choice colours (also when the value is changed in Excel).
 */
async function buildWorkbook(cfg, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Umoor Sehhat";
  wb.created = new Date();
  const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  const cols = cfg.columns;
  const choices = cfg.choices || [];

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

  for (const r of rows) ws.addRow(cols.map((_, i) => r.cells[i] || ""));
  const last = rows.length + 1;

  cols.forEach((c, i) => {
    if (!c.dropdown || !choices.length) return;
    const col = ws.getColumn(i + 1);
    const L = col.letter;
    for (let n = 2; n <= Math.max(last, 2); n++) {
      const cell = ws.getCell(`${L}${n}`);
      cell.dataValidation = {
        type: "list", allowBlank: true, formulae: [listFormula(choices)],
        showErrorMessage: true, errorStyle: "stop", errorTitle: "Choose from the list", error: `Choose one of: ${choices.map((x) => x.value).join(", ")}`,
      };
      const ch = choices.find((x) => x.value === cell.value);
      const p = ch && PALETTE[ch.color];
      if (p) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(p.bg) } };
        cell.font = { color: { argb: argb(p.ink) }, bold: true };
      }
    }
    // Colour follows the value when it is changed in Excel.
    if (last >= 2) {
      ws.addConditionalFormatting({
        ref: `${L}2:${L}${last}`,
        rules: [
          ...choices.map((ch, k) => {
            const p = PALETTE[ch.color] || PALETTE.grey;
            return {
              type: "expression", priority: k + 1, formulae: [`$${L}2="${ch.value}"`],
              style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: argb(p.bg) } }, font: { color: { argb: argb(p.ink) }, bold: true } },
            };
          }),
          { type: "expression", priority: choices.length + 1, formulae: [`LEN($${L}2)=0`], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFFFFF" } } } },
        ],
      });
    }
  });
  if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return wb.xlsx.writeBuffer();
}

module.exports = { readExcel, planUpload, buildWorkbook, cellText, choiceOf, nameKey, valKey, MAX_ROWS };
