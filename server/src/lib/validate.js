// Input checks shared by the JC portal and the masters screen.
const { mongoose } = require("../db");
const form = require("../formConfig");
const { cleanName } = require("./names");

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isId = (v) => typeof v === "string" && mongoose.Types.ObjectId.isValid(v) && String(new mongoose.Types.ObjectId(v)) === v;

function requireId(v, what) {
  if (!isId(v)) throw new InputError(`Choose a ${what}.`);
  return v;
}

function parseName(v, what, max) {
  const name = cleanName(v);
  if (name.length < 2) throw new InputError(`${what} name must have at least 2 letters.`);
  if (name.length > max) throw new InputError(`${what} name is too long (max ${max} characters).`);
  return name;
}

// Empty -> null, otherwise a whole number from 0 to 1,000,000.
function parseCount(v, label) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new InputError(`${label} must be a whole number (0 or more).`);
  return n;
}

// `allowed` = current Mauze Type dropdown values. Returns the list's spelling, or "".
function parseMauzeType(v, allowed) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s) return "";
  const hit = allowed.find((a) => a.toLowerCase() === s);
  if (!hit) throw new InputError(`Mauze Type must be one of: ${allowed.join(", ")}.`);
  return hit;
}

/** Mauze Type / House Count / Children; only the keys present in `body` are returned. */
function parseJamaatDetails(body, mauzeTypes) {
  const out = {};
  if ("mauzeType" in body) out.mauzeType = parseMauzeType(body.mauzeType, mauzeTypes);
  if ("houseCount" in body) out.houseCount = parseCount(body.houseCount, "House Count");
  if ("children" in body) out.children = parseCount(body.children, "Children");
  return out;
}

// A real calendar date "YYYY-MM-DD", from 2020 up to tomorrow (any time zone's "today" fits).
function parseDate(v, label) {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const ok = d && d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  if (!ok) throw new InputError(`Choose a valid date for ${label}.`);
  if (+m[1] < 2020 || d.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new InputError(`${label} can't be in the future.`);
  return s;
}

/**
 * Answers for the active portal fields. A dropdown answer must be one of that field's options,
 * a date question takes a date; required fields must be answered.
 * Returns { [key]: value } (unanswered optional fields left out).
 */
function parseValues(values, fields) {
  if (!values || typeof values !== "object") throw new InputError("Answer all the questions.");
  const out = {};
  const missing = [];
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === null || v === "") {
      if (f.required) missing.push(f.label);
      continue;
    }
    if (f.type === "date") {
      out[f.key] = parseDate(v, f.label);
      continue;
    }
    if (!f.options.some((o) => o.value === v)) {
      throw new InputError(`"${String(v).slice(0, 40)}" is not a choice for ${f.label}. Reload the page.`);
    }
    out[f.key] = v;
  }
  if (missing.length) throw new InputError(`Please answer: ${missing.join(" · ")}`);
  return out;
}

/** Comment boxes: only for fields that have one; empty ones are left out. Returns { [key]: text }. */
function parseComments(comments, fields) {
  const src = comments && typeof comments === "object" ? comments : {};
  const out = {};
  for (const f of fields) {
    if (!f.hasComment) continue;
    const s = String(src[f.key] == null ? "" : src[f.key]).replace(/\r\n/g, "\n").trim();
    if (s.length > form.commentMaxLength) throw new InputError(`The comment for ${f.label} is too long (max ${form.commentMaxLength} characters).`);
    if (s) out[f.key] = s;
  }
  return out;
}

function parseRemarks(v) {
  const s = String(v == null ? "" : v).replace(/\r\n/g, "\n").trim();
  if (s.length > form.remarksMaxLength) throw new InputError(`Remarks are too long (max ${form.remarksMaxLength} characters).`);
  return s;
}

/** Express error helper: InputError -> its status, duplicate key -> 409, else pass on. */
function sendError(err, res, next, duplicateMessage = "This already exists.") {
  if (err instanceof InputError) return res.status(err.status).json({ error: err.message });
  if (err && err.code === 11000) return res.status(409).json({ error: duplicateMessage });
  if (err && err.name === "ValidationError") {
    return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join(" ") });
  }
  next(err);
}

module.exports = { InputError, isId, requireId, parseName, parseCount, parseJamaatDetails, parseValues, parseComments, parseRemarks, sendError };
