// Months are Hijri months of the Misri (Fatemi) calendar, stored as "YYYY-MM" strings,
// e.g. "1448-05" = Jumadal Ula 1448. The Misri calendar is calculated, not sighted:
//   - odd months have 30 days, even months 29; the 12th month has 30 days in a leap year
//   - 11 leap years in every 30 years: years 2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29 of the cycle
//   - day 1 (1 Moharram 1) = Thursday 15 July 622 (Julian)
// A new day (and month) starts at midnight in formConfig.timeZone (Indian time).
const { timeZone, firstMonth, hijriMonthNames } = require("../formConfig");

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LEAP = new Set([2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29]);
const DAY = 24 * 60 * 60 * 1000;
const EPOCH = Date.UTC(622, 6, 18); // 15 July 622 Julian, written as a (proleptic) Gregorian date
const CYCLE_DAYS = 10631;           // days in 30 Hijri years

const isMonth = (v) => typeof v === "string" && MONTH_RE.test(v);
const isLeap = (y) => LEAP.has(((y - 1) % 30) + 1);
const yearDays = (y) => (isLeap(y) ? 355 : 354);
const monthDays = (y, m) => (m % 2 ? 30 : m === 12 && isLeap(y) ? 30 : 29);
const key = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const parse = (month) => month.split("-").map(Number);

// Days from the epoch to the 1st of a Hijri month.
function monthStartDays(y, m) {
  let d = Math.floor((y - 1) / 30) * CYCLE_DAYS;
  for (let i = Math.floor((y - 1) / 30) * 30 + 1; i < y; i++) d += yearDays(i);
  for (let i = 1; i < m; i++) d += monthDays(y, i);
  return d;
}

/** Gregorian calendar day (UTC midnight ms) -> { y, m, d } Hijri. */
function fromGregorian(ms) {
  let days = Math.floor((ms - EPOCH) / DAY);
  let y = Math.floor(days / CYCLE_DAYS) * 30 + 1;
  days -= Math.floor(days / CYCLE_DAYS) * CYCLE_DAYS;
  while (days >= yearDays(y)) { days -= yearDays(y); y++; }
  let m = 1;
  while (days >= monthDays(y, m)) { days -= monthDays(y, m); m++; }
  return { y, m, d: days + 1 };
}

/** Today's calendar date in Indian time, as UTC-midnight ms. */
function todayMs(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

function currentMonth(now = new Date()) {
  const { y, m } = fromGregorian(todayMs(now));
  return key(y, m);
}

function addMonths(month, n) {
  const [y, m] = parse(month);
  const i = y * 12 + (m - 1) + n;
  return key(Math.floor(i / 12), (i % 12) + 1);
}

const monthName = (month) => (isMonth(month) ? hijriMonthNames[parse(month)[1] - 1] : "");
function monthLabel(month) {
  if (!isMonth(month)) return "";
  const [y, m] = parse(month);
  return `${hijriMonthNames[m - 1]} ${y}`;
}

/** First and last English date of a Hijri month: { from: Date, to: Date } (UTC midnight). */
function monthRange(month) {
  const [y, m] = parse(month);
  const from = EPOCH + monthStartDays(y, m) * DAY;
  return { from: new Date(from), to: new Date(from + (monthDays(y, m) - 1) * DAY) };
}

// "23 Oct – 21 Nov 2026" (the English dates a Hijri month covers).
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function rangeText(month) {
  const { from, to } = monthRange(month);
  const f = (d, year) => `${d.getUTCDate()} ${SHORT[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
  return `${f(from, from.getUTCFullYear() !== to.getUTCFullYear())} – ${f(to, true)}`;
}

/** What the pickers need for one month. */
const monthInfo = (k) => ({ key: k, label: monthLabel(k), name: monthName(k), range: rangeText(k) });

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

module.exports = { isMonth, currentMonth, addMonths, monthLabel, monthName, monthRange, rangeText, monthInfo, monthsSince, portalMonths, fromGregorian };
