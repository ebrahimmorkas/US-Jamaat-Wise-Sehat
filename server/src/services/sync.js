// Pulls the sheet, keeps the latest snapshot in memory, and persists it to MongoDB.
const config = require("../config");
const dash = require("../dashboardConfig");
const { readRanges } = require("./sheetReader");
const { isDbReady } = require("../db");
const Snapshot = require("../models/Snapshot");
const SyncLog = require("../models/SyncLog");

const colIndex = (letter) =>
  letter.toUpperCase().split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
const rangeStartCol = (range) => colIndex(range.match(/^[A-Z]+/i)[0]);

let current = null;      // latest snapshot (plain object)
let inFlight = null;     // promise of a running sync
let lastAttemptAt = 0;
let lastError = null;
let timer = null;
let nextSyncAt = null;

async function fetchSnapshot() {
  // 1) Jamiat list + month
  const [list, month] = await readRanges([
    { sheet: dash.dashboardSheet, range: dash.jamiatListRange },
    { sheet: dash.dashboardSheet, range: dash.monthCell },
  ]);
  if (list.error) throw new Error(`Could not read "${dash.dashboardSheet}": ${list.error}`);
  const names = [...new Set(list.rows.map((r) => (r[0] || "").trim()).filter(Boolean))];

  // 2) Every Jamiat tab
  const start = rangeStartCol(dash.jamaatDataRange);
  const remarksIdx = colIndex(dash.remarksColumn) - start;
  const metricIdx = dash.metrics.map((m) => [m.key, colIndex(m.column) - start]);
  const results = await readRanges(names.map((sheet) => ({ sheet, range: dash.jamaatDataRange })));

  const failed = [];
  const jamiats = results.map((res) => {
    if (res.error) {
      failed.push({ sheet: res.sheet, error: res.error });
      return { name: res.sheet, jamaats: [] };
    }
    const jamaats = [];
    for (const row of res.rows) {
      const name = (row[0] || "").trim();
      if (!name) continue;
      const values = {};
      for (const [key, idx] of metricIdx) values[key] = (row[idx] || "").trim();
      jamaats.push({ name, values, remarks: (row[remarksIdx] || "").trim() });
    }
    return { name: res.sheet, jamaats };
  });

  return {
    month: month && !month.error && month.rows[0] ? month.rows[0][0] || "" : "",
    jamiats,
    failed,
    source: config.sheetAccess,
    syncedAt: new Date(),
  };
}

async function persist(snapshot, log) {
  if (!isDbReady()) return;
  try {
    await Snapshot.updateOne({ key: "latest" }, { $set: { key: "latest", ...snapshot } }, { upsert: true });
    await SyncLog.create(log);
  } catch (err) {
    console.warn("[sync] Could not save to MongoDB:", err.message);
  }
}

function syncNow(trigger = "schedule") {
  if (inFlight) return inFlight;
  lastAttemptAt = Date.now();
  inFlight = (async () => {
    const t0 = Date.now();
    try {
      const snap = await fetchSnapshot();
      current = snap;
      lastError = null;
      const jamaatCount = snap.jamiats.reduce((n, j) => n + j.jamaats.length, 0);
      console.log(
        `[sync] ${trigger}: ${snap.jamiats.length} Jamiats, ${jamaatCount} Jamaats in ${Date.now() - t0} ms` +
          (snap.failed.length ? ` (failed: ${snap.failed.map((f) => f.sheet).join(", ")})` : "")
      );
      await persist(snap, {
        trigger, ok: true, durationMs: Date.now() - t0,
        jamiatCount: snap.jamiats.length, jamaatCount,
        failedSheets: snap.failed.map((f) => f.sheet),
      });
      return snap;
    } catch (err) {
      lastError = err.message;
      console.error(`[sync] ${trigger} failed:`, err.message);
      if (isDbReady()) {
        await SyncLog.create({ trigger, ok: false, durationMs: Date.now() - t0, error: err.message }).catch(() => {});
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function loadFromDb() {
  if (!isDbReady()) return;
  try {
    const doc = await Snapshot.findOne({ key: "latest" }).lean();
    if (doc && doc.jamiats && doc.jamiats.length) {
      current = {
        month: doc.month,
        jamiats: doc.jamiats.map((j) => ({
          name: j.name,
          jamaats: j.jamaats.map((jm) => ({ name: jm.name, values: jm.values || {}, remarks: jm.remarks || "" })),
        })),
        failed: doc.failed || [],
        source: doc.source,
        syncedAt: doc.syncedAt,
      };
      console.log(`[sync] Loaded last snapshot from MongoDB (synced ${doc.syncedAt.toISOString()})`);
    }
  } catch (err) {
    console.warn("[sync] Could not load snapshot from MongoDB:", err.message);
  }
}

function startSchedule() {
  const secs = config.syncIntervalSeconds;
  if (!secs) return;
  nextSyncAt = new Date(Date.now() + secs * 1000);
  timer = setInterval(() => {
    nextSyncAt = new Date(Date.now() + secs * 1000);
    syncNow("schedule").catch(() => {});
  }, secs * 1000);
  timer.unref();
}

module.exports = {
  syncNow,
  loadFromDb,
  startSchedule,
  getCurrent: () => current,
  getStatus: () => ({ lastAttemptAt, lastError, nextSyncAt, syncing: !!inFlight }),
};
