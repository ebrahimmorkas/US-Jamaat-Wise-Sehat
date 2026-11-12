// Reads the masters and the monthly entries from MongoDB.
const { dashboardMetrics } = require("./fields");
const Jamiat = require("../models/Jamiat");
const Jamaat = require("../models/Jamaat");
const Entry = require("../models/Entry");
const { notDeleted } = require("../lib/softDelete");
const { currentMonth, monthLabel, recentMonths } = require("../lib/month");

const byName = (a, b) => a.name.localeCompare(b.name);

/** Active Jamiats with their active Jamaats, sorted by name. */
async function activeMasters() {
  const jamiats = await Jamiat.find({ isActive: true, ...notDeleted() }).select("name").lean();
  const jamaats = await Jamaat.find({ isActive: true, ...notDeleted(), jamiat: { $in: jamiats.map((j) => j._id) } })
    .select("jamiat name mauzeType houseCount children")
    .lean();
  const groups = new Map(jamiats.map((j) => [String(j._id), { ...j, jamaats: [] }]));
  for (const jm of jamaats) groups.get(String(jm.jamiat)).jamaats.push(jm);
  const list = [...groups.values()].sort(byName);
  for (const j of list) j.jamaats.sort(byName);
  return list;
}

/** Months that have at least one entry, plus the portal's recent months, newest first. */
async function availableMonths() {
  const used = await Entry.distinct("month");
  return [...new Set([...recentMonths(0), ...used])].sort().reverse();
}

/** Everything the dashboard needs for one month. */
async function dashboardData(month) {
  const m = month || currentMonth();
  const [masters, months] = await Promise.all([activeMasters(), availableMonths()]);
  const ids = masters.flatMap((j) => j.jamaats.map((jm) => jm._id));
  const entries = await Entry.find({ month: m, jamaat: { $in: ids } }).select("jamaat values remarks updatedAt").lean();
  const byJamaat = new Map(entries.map((e) => [String(e.jamaat), e]));

  const keys = (await dashboardMetrics()).map((m) => m.key);
  const jamiats = masters.map((j) => ({
    name: j.name,
    jamaats: j.jamaats.map((jm) => {
      const e = byJamaat.get(String(jm._id));
      const values = {};
      for (const k of keys) values[k] = (e && e.values && e.values[k]) || "";
      return { name: jm.name, values, remarks: (e && e.remarks) || "", submittedAt: e ? e.updatedAt : null };
    }),
  }));

  return {
    month: m,
    monthLabel: monthLabel(m),
    months: months.map((key) => ({ key, label: monthLabel(key) })),
    jamiats,
    submitted: entries.length,
    loadedAt: new Date(),
  };
}

module.exports = { activeMasters, dashboardData };
