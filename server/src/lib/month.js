// Months are stored as "YYYY-MM" strings, e.g. "2026-11".
const { timeZone } = require("../formConfig");

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

/** The current month and `back` months before it, newest first. */
const recentMonths = (back) => Array.from({ length: back + 1 }, (_, i) => addMonths(currentMonth(), -i));

module.exports = { isMonth, currentMonth, addMonths, monthLabel, recentMonths };
