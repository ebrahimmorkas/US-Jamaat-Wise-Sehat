// Months are stored as "YYYY-MM" strings, e.g. "2026-11".
const { timeZone, firstMonth } = require("../formConfig");

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const isMonth = (v) => typeof v === "string" && MONTH_RE.test(v);

function currentMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}`;
}

function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month) {
  if (!isMonth(month)) return "";
  const [y, m] = month.split("-").map(Number);
  return `${NAMES[m - 1]} ${y}`;
}

/** Every month from `first` up to the current month, newest first (never a future month). */
function monthsSince(first) {
  const now = currentMonth();
  const out = [now];
  if (!isMonth(first)) return out;
  for (let m = addMonths(now, -1); m >= first; m = addMonths(m, -1)) out.push(m);
  return out;
}

/** Months the JC portal offers: formConfig.firstMonth .. current month, newest first. */
const portalMonths = () => monthsSince(firstMonth);

module.exports = { isMonth, currentMonth, addMonths, monthLabel, monthsSince, portalMonths };
