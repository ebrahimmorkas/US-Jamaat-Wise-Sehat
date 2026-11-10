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

/** Every form question must be answered with one of its allowed values (`sets` = current dropdown values). */
function parseValues(values, sets) {
  if (!values || typeof values !== "object") throw new InputError("Answer all the questions.");
  const out = {};
  const missing = [];
  for (const f of form.fields) {
    const allowed = sets[f.statuses] || [];
    const v = values[f.key];
    if (!allowed.includes(v)) missing.push(f.label);
    else out[f.key] = v;
  }
  if (missing.length) throw new InputError(`Please answer: ${missing.join(" · ")}`);
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

module.exports = { InputError, isId, requireId, parseName, parseCount, parseJamaatDetails, parseValues, parseRemarks, sendError };
