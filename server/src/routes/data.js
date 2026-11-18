// "Data" tab (Excel data per Jamiat / Jamaat).
//   Super Admin: upload a file (preview first), choose dropdown columns, edit the dropdown choices, download all, clear.
//   JC: see their own Jamaats' rows, change the dropdown cells, download their rows.
const express = require("express");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const User = require("../models/User");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const { DataRow, PALETTE, getConfig } = require("../models/DataSheet");
const { readExcel, planUpload, buildWorkbook, choiceOf, valKey } = require("../services/dataSheet");
const { audit } = require("../services/audit");
const { InputError, requireId, sendError } = require("../lib/validate");

const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

const MAX_FILE = 10 * 1024 * 1024;
const fileBody = express.raw({ type: "application/octet-stream", limit: MAX_FILE });

const choicesOut = (cfg) => (cfg.choices || []).map((c) => ({ id: String(c._id), value: c.value, color: c.color }));
const configOut = (cfg) => ({
  hasData: cfg.version > 0 && cfg.columns.length > 0,
  version: cfg.version,
  columns: cfg.columns.map((c) => ({ name: c.name, dropdown: !!c.dropdown })),
  jamiatCol: cfg.jamiatCol,
  jamaatCol: cfg.jamaatCol,
  fileName: cfg.fileName,
  rowCount: cfg.rowCount,
  uploadedAt: cfg.uploadedAt || null,
  uploadedBy: cfg.uploadedBy || "",
  choices: choicesOut(cfg),
  palette: PALETTE,
});

async function accessOf(req) {
  const u = await User.findById(req.user.id).select("jamiats jamaats").lean();
  return { jamiats: new Set(((u && u.jamiats) || []).map(String)), jamaats: new Set(((u && u.jamaats) || []).map(String)) };
}
const allowed = (access, row) => access.jamiats.has(String(row.jamiat)) && access.jamaats.has(String(row.jamaat));

/** Rows this person may see, grouped Jamiat › Jamaat (names A–Z, rows in file order). */
async function groupedRows(cfg, access) {
  if (!cfg.version) return [];
  const filter = { version: cfg.version };
  if (access) filter.jamaat = { $in: [...access.jamaats] };
  const rows = (await DataRow.find(filter).select("jamiat jamaat order cells").sort({ order: 1 }).lean()).filter((r) => !access || allowed(access, r));
  const jamiatIds = [...new Set(rows.map((r) => String(r.jamiat)))];
  const jamaatIds = [...new Set(rows.map((r) => String(r.jamaat)))];
  const [jamiats, jamaats] = await Promise.all([
    Jamiat.find({ _id: { $in: jamiatIds } }).select("name").lean(),
    Jamaat.find({ _id: { $in: jamaatIds } }).select("name").lean(),
  ]);
  const jName = new Map(jamiats.map((j) => [String(j._id), j.name]));
  const mName = new Map(jamaats.map((m) => [String(m._id), m.name]));
  const byJamiat = new Map();
  for (const r of rows) {
    const jid = String(r.jamiat);
    const mid = String(r.jamaat);
    if (!byJamiat.has(jid)) byJamiat.set(jid, { id: jid, name: jName.get(jid) || "?", jamaats: new Map() });
    const g = byJamiat.get(jid);
    if (!g.jamaats.has(mid)) g.jamaats.set(mid, { id: mid, name: mName.get(mid) || "?", rows: [] });
    g.jamaats.get(mid).rows.push({ id: String(r._id), order: r.order, cells: r.cells });
  }
  const az = (a, b) => a.name.localeCompare(b.name);
  return [...byJamiat.values()].sort(az).map((g) => ({ ...g, jamaats: [...g.jamaats.values()].sort(az) }));
}

// ---------- JC ----------
// GET /api/data — the JC's own rows.
router.get("/", requireRole("jc"), async (req, res, next) => {
  try {
    const cfg = await getConfig();
    const jamiats = await groupedRows(cfg, await accessOf(req));
    audit(req, "data_viewed", { details: { rows: jamiats.reduce((n, j) => n + j.jamaats.reduce((m, x) => m + x.rows.length, 0), 0) } });
    res.json({ ...configOut(cfg), fileName: undefined, uploadedBy: undefined, jamiats });
  } catch (err) { next(err); }
});

// PATCH /api/data/rows/:id { column, value, version } — a JC sets one dropdown cell of their own Jamaat.
router.patch("/rows/:id", requireRole("jc"), async (req, res, next) => {
  try {
    const id = requireId(req.params.id, "row");
    const { column, value, version } = req.body || {};
    const cfg = await getConfig();
    if (Number(version) !== cfg.version) throw new InputError("The data was replaced by a new upload. Reload the page to see it.", 409);
    const i = Number(column);
    const col = Number.isInteger(i) ? cfg.columns[i] : null;
    if (!col || !col.dropdown) throw new InputError("This column can't be changed.");
    const v = typeof value === "string" ? value : "";
    const pick = v.trim() ? choiceOf(cfg.choices, v) : "";
    if (pick === null) throw new InputError(`Choose one of: ${cfg.choices.map((c) => c.value).join(", ")}.`);

    const row = await DataRow.findById(id).lean();
    if (!row || row.version !== cfg.version) throw new InputError("The data was replaced by a new upload. Reload the page to see it.", 409);
    const access = await accessOf(req);
    if (!allowed(access, row)) {
      audit(req, "access_denied", { success: false, details: { method: req.method, path: req.originalUrl.slice(0, 300), reason: "not_their_jamaat" } });
      return res.status(403).json({ error: "This Jamaat is not assigned to you.", code: "FORBIDDEN" });
    }
    const from = row.cells[i] || "";
    if (from !== pick) {
      await DataRow.updateOne({ _id: row._id }, { $set: { [`cells.${i}`]: pick, editedBy: req.user.username, editedAt: new Date() } });
      const jm = await Jamaat.findById(row.jamaat).select("name").lean();
      audit(req, "data_changed", {
        target: { type: "jamaat", id: String(row.jamaat), label: jm ? jm.name : "" },
        changes: [{ field: col.name, label: col.name, from: from || null, to: pick || null }],
        details: { row: row.order + 1, column: col.name },
      });
    }
    res.json({ ok: true, value: pick });
  } catch (err) { sendError(err, res, next); }
});

// GET /api/data/download — Excel file: a JC gets their rows, the Super Admin everything.
router.get("/download", requireRole("jc", "superadmin"), async (req, res, next) => {
  try {
    const cfg = await getConfig();
    if (!cfg.version || !cfg.columns.length) return res.status(404).json({ error: "No data has been uploaded yet." });
    const groups = await groupedRows(cfg, req.user.role === "jc" ? await accessOf(req) : null);
    // Same order as the uploaded file.
    const rows = groups.flatMap((j) => j.jamaats.flatMap((m) => m.rows)).sort((a, b) => a.order - b.order);
    const buf = await buildWorkbook(cfg, rows);
    const day = new Date().toISOString().slice(0, 10);
    audit(req, "data_downloaded", { details: { rows: rows.length } });
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Jamaat Data ${day}.xlsx"`,
    });
    res.send(Buffer.from(buf));
  } catch (err) { next(err); }
});

// ---------- Super Admin ----------
const admin = requireRole("superadmin");

// GET /api/data/admin — current upload and choices (no rows).
router.get("/admin", admin, async (req, res, next) => {
  try {
    const cfg = await getConfig();
    let counts = { jamiats: 0, jamaats: 0, picked: 0 };
    if (cfg.version) {
      const [jamiats, jamaats] = await Promise.all([DataRow.distinct("jamiat", { version: cfg.version }), DataRow.distinct("jamaat", { version: cfg.version })]);
      const drop = cfg.columns.map((c, i) => (c.dropdown ? i : -1)).filter((i) => i >= 0);
      const picked = drop.length ? await DataRow.countDocuments({ version: cfg.version, $or: drop.map((i) => ({ [`cells.${i}`]: { $nin: ["", null] } })) }) : 0;
      counts = { jamiats: jamiats.length, jamaats: jamaats.length, picked };
    }
    res.json({ ...configOut(cfg), counts });
  } catch (err) { next(err); }
});

function uploadOptions(req) {
  let o = {};
  try { o = JSON.parse(String(req.query.o || "{}")); } catch { /* defaults */ }
  return {
    jamiatCol: Number.isInteger(o.jamiatCol) ? o.jamiatCol : undefined,
    jamaatCol: Number.isInteger(o.jamaatCol) ? o.jamaatCol : undefined,
    dropdown: Array.isArray(o.dropdown) ? o.dropdown.slice(0, 100).map((x) => String(x).slice(0, 120)) : undefined,
  };
}
const fileName = (req) => {
  try { return decodeURIComponent(String(req.get("x-file-name") || "")).slice(0, 150); } catch { return ""; }
};
const fileOf = (req) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new InputError("Choose an Excel file to upload.");
  return req.body;
};
const planOut = (p) => ({
  sheet: p.sheet,
  headers: p.headers,
  jamiatCol: p.jamiatCol,
  jamaatCol: p.jamaatCol,
  columns: p.columns,
  needCols: !!p.needCols,
  stats: p.stats,
  unmatched: p.unmatched.slice(0, 300),
  sample: p.rows.slice(0, 5).map((r) => r.cells),
});

// POST /api/data/preview (the .xlsx file as the body; options in ?o=) — what the upload would do. Saves nothing.
router.post("/preview", admin, fileBody, async (req, res, next) => {
  try {
    const cfg = await getConfig();
    const plan = await planUpload(await readExcel(fileOf(req)), uploadOptions(req), cfg);
    res.json(planOut(plan));
  } catch (err) { sendError(err, res, next); }
});

// POST /api/data/upload (same body) — replaces the data; same rows keep the dropdown values JCs chose.
router.post("/upload", admin, fileBody, async (req, res, next) => {
  try {
    const cfg = await getConfig();
    const plan = await planUpload(await readExcel(fileOf(req)), uploadOptions(req), cfg);
    if (plan.needCols) throw new InputError("Choose which columns hold the Jamiat and the Jamaat.");
    if (!plan.rows.length) throw new InputError("No row matched a Jamiat and Jamaat in Masters, so nothing was saved.");

    const version = cfg.version + 1;
    const docs = plan.rows.map((r, order) => ({ version, jamiat: r.jamiat, jamaat: r.jamaat, order, cells: r.cells }));
    for (let i = 0; i < docs.length; i += 1000) await DataRow.insertMany(docs.slice(i, i + 1000), { ordered: false });
    const before = cfg.columns.map((c) => c.name);
    cfg.set({
      columns: plan.columns, jamiatCol: plan.jamiatCol, jamaatCol: plan.jamaatCol, version,
      fileName: fileName(req), rowCount: docs.length, uploadedAt: new Date(), uploadedBy: req.user.username,
    });
    await cfg.save();
    await DataRow.deleteMany({ version: { $ne: version } });

    audit(req, "data_uploaded", {
      target: { type: "data", label: fileName(req) || "Excel file" },
      details: {
        file: fileName(req), rows: docs.length, unmatched: plan.stats.unmatched, kept: plan.stats.kept, added: plan.stats.added, removed: plan.stats.removed,
        columns: plan.columns.map((c) => c.name), dropdown: plan.columns.filter((c) => c.dropdown).map((c) => c.name), columnsBefore: before,
      },
    });
    res.json({ ok: true, stats: plan.stats, config: configOut(cfg) });
  } catch (err) { sendError(err, res, next); }
});

// PUT /api/data/choices { choices: [{ id?, value, color }] } — the one list used by every dropdown column.
// A renamed choice is renamed in the data too; cells with a removed choice become empty.
router.put("/choices", admin, async (req, res, next) => {
  try {
    const list = Array.isArray(req.body && req.body.choices) ? req.body.choices : null;
    if (!list || !list.length) throw new InputError("Keep at least one choice.");
    if (list.length > 20) throw new InputError("At most 20 choices.");
    const seen = new Set();
    const clean = list.map((c, n) => {
      const value = String((c && c.value) || "").replace(/\s+/g, " ").trim();
      if (!value) throw new InputError(`Choice ${n + 1} has no name.`);
      if (value.length > 30) throw new InputError(`“${value}” is too long (at most 30 characters).`);
      if (/[,"]/.test(value)) throw new InputError(`“${value}”: commas and double quotes can't be used in a choice.`);
      if (seen.has(valKey(value))) throw new InputError(`“${value}” is in the list twice.`);
      seen.add(valKey(value));
      if (!PALETTE[c.color]) throw new InputError(`Pick a colour for “${value}”.`);
      return { id: typeof c.id === "string" ? c.id : "", value, color: c.color };
    });

    const cfg = await getConfig();
    const old = cfg.choices.map((c) => ({ id: String(c._id), value: c.value, color: c.color }));
    const renames = [];
    const removed = [];
    for (const o of old) {
      const now = clean.find((c) => c.id === o.id);
      if (!now) removed.push(o.value);
      else if (now.value !== o.value) renames.push([o.value, now.value]);
    }
    cfg.choices = clean.map((c) => (old.some((o) => o.id === c.id) ? { _id: c.id, value: c.value, color: c.color } : { value: c.value, color: c.color }));
    await cfg.save();

    let changedCells = 0;
    const drop = cfg.columns.map((c, i) => (c.dropdown ? i : -1)).filter((i) => i >= 0);
    if (cfg.version && drop.length) {
      for (const i of drop) {
        for (const [a, b] of renames) changedCells += (await DataRow.updateMany({ version: cfg.version, [`cells.${i}`]: a }, { $set: { [`cells.${i}`]: b } })).modifiedCount;
        if (removed.length) changedCells += (await DataRow.updateMany({ version: cfg.version, [`cells.${i}`]: { $in: removed } }, { $set: { [`cells.${i}`]: "" } })).modifiedCount;
      }
    }
    const fmt = (l) => l.map((c) => `${c.value} (${(PALETTE[c.color] || {}).label || c.color})`).join(", ");
    audit(req, "data_choices_changed", {
      target: { type: "data", label: "Dropdown choices" },
      changes: [{ field: "choices", label: "Choices", from: fmt(old), to: fmt(clean) }],
      details: { renamed: renames.map(([a, b]) => `${a} → ${b}`), removed, cellsChanged: changedCells },
    });
    res.json({ ...configOut(cfg), changedCells });
  } catch (err) { sendError(err, res, next); }
});

// POST /api/data/clear { confirm: "CLEAR" } — removes the uploaded data (the choices stay).
router.post("/clear", admin, async (req, res, next) => {
  try {
    if (!req.body || req.body.confirm !== "CLEAR") throw new InputError("Not confirmed.");
    const cfg = await getConfig();
    const rows = (await DataRow.deleteMany({})).deletedCount;
    const file = cfg.fileName;
    cfg.set({ columns: [], jamiatCol: -1, jamaatCol: -1, version: cfg.version + 1, fileName: "", rowCount: 0, uploadedAt: null, uploadedBy: "" });
    await cfg.save();
    audit(req, "data_cleared", { target: { type: "data", label: file || "Data" }, details: { rows, file } });
    res.json(configOut(cfg));
  } catch (err) { sendError(err, res, next); }
});

module.exports = router;
