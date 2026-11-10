// JC portal (/jc-portal): signed-in JCs only, and only for the Jamiats / Jamaats assigned to them.
// Every submission is audit-logged with the JC's Gmail and IP.
const express = require("express");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const form = require("../formConfig");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const User = require("../models/User");
const Jamaat = require("../models/Jamaat");
const Jamiat = require("../models/Jamiat");
const Entry = require("../models/Entry");
const { audit } = require("../services/audit");
const { activeMasters } = require("../services/data");
const { getValueSets } = require("../services/lists");
const { activeFields, portalShape } = require("../services/fields");
const { clientIp } = require("../lib/clientIp");
const { monthLabel, recentMonths } = require("../lib/month");
const { InputError, requireId, parseJamaatDetails, parseValues, parseRemarks, sendError } = require("../lib/validate");

const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
}, requireAuth, requireRole("jc"));

// The JC's assignment as two Sets of ids. A Jamaat counts only if its Jamiat is assigned too.
async function accessOf(req) {
  const u = await User.findById(req.user.id).select("jamiats jamaats").lean();
  return { jamiats: new Set((u.jamiats || []).map(String)), jamaats: new Set((u.jamaats || []).map(String)) };
}
const canFill = (access, jamaat) => access.jamiats.has(String(jamaat.jamiat)) && access.jamaats.has(String(jamaat._id));

const details = (jm) => ({
  mauzeType: jm.mauzeType || "",
  houseCount: jm.houseCount == null ? null : jm.houseCount,
  children: jm.children == null ? null : jm.children,
});

function checkMonth(month) {
  if (!recentMonths(form.portalMonthsBack).includes(month)) throw new InputError("Choose a valid month.");
  return month;
}

// An active Jamaat inside an active Jamiat, assigned to this JC.
async function findJamaat(req, id) {
  const jm = await Jamaat.findOne({ _id: requireId(id, "Jamaat"), isActive: true });
  const jt = jm && (await Jamiat.findOne({ _id: jm.jamiat, isActive: true }).select("name").lean());
  if (!jm || !jt) throw new InputError("This Jamaat is not available. Reload the page.", 404);
  if (!canFill(await accessOf(req), jm)) throw new InputError("This Jamaat is not assigned to you.", 403);
  return { jamaat: jm, jamiat: jt };
}

// ---------- GET /api/portal/options ----------  form questions + Jamiat/Jamaat lists
router.get("/options", async (req, res, next) => {
  try {
    const [masters, fields, sets, access] = await Promise.all([activeMasters(), activeFields(), getValueSets(), accessOf(req)]);
    res.json({
      months: recentMonths(form.portalMonthsBack).map((key) => ({ key, label: monthLabel(key) })),
      fields: fields.map(portalShape),
      mauzeTypes: sets.mauzeType,
      remarksLabel: form.remarksLabel,
      remarksMaxLength: form.remarksMaxLength,
      // Only what is assigned to this JC.
      jamiats: masters
        .filter((j) => access.jamiats.has(String(j._id)))
        .map((j) => ({
          id: String(j._id),
          name: j.name,
          jamaats: j.jamaats.filter((jm) => access.jamaats.has(String(jm._id))).map((jm) => ({ id: String(jm._id), name: jm.name })),
        }))
        .filter((j) => j.jamaats.length),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/portal/entry?jamaat=<id>&month=YYYY-MM ----------  what is saved already
router.get("/entry", async (req, res, next) => {
  try {
    const month = checkMonth(req.query.month);
    const { jamaat } = await findJamaat(req, req.query.jamaat);
    const entry = await Entry.findOne({ jamaat: jamaat._id, month }).select("values remarks updatedAt").lean();
    res.json({
      details: details(jamaat),
      entry: entry ? { values: entry.values, remarks: entry.remarks || "", updatedAt: entry.updatedAt } : null,
    });
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- POST /api/portal/entry ----------  save (or update) one Jamaat's month
const submitLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(clientIp(req)),
  message: { error: "Too many submissions. Please wait a minute and try again." },
});

router.post("/entry", submitLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const month = checkMonth(body.month);
    const [sets, fields] = await Promise.all([getValueSets(), activeFields()]);
    const answers = parseValues(body.values, fields);
    const remarks = parseRemarks(body.remarks);
    const newDetails = parseJamaatDetails(body.details || {}, sets.mauzeType);
    const { jamaat, jamiat } = await findJamaat(req, body.jamaatId);

    const before = await Entry.findOne({ jamaat: jamaat._id, month }).select("values remarks").lean();
    // Keep answers of questions that are inactive now; replace the ones on the form.
    const values = { ...((before && before.values) || {}) };
    for (const f of fields) {
      if (f.key in answers) values[f.key] = answers[f.key];
      else delete values[f.key];
    }
    const entry = await Entry.findOneAndUpdate(
      { jamaat: jamaat._id, month },
      { $set: { values, remarks, lastIp: clientIp(req) }, $inc: { submitCount: 1 } },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
    );

    // Jamaat details live in the Jamaat master: update them when the JC corrected them.
    const oldDetails = details(jamaat);
    const detailChanges = {};
    for (const [k, v] of Object.entries(newDetails)) if (v !== oldDetails[k]) detailChanges[k] = { from: oldDetails[k], to: v };
    if (Object.keys(detailChanges).length) {
      Object.assign(jamaat, newDetails);
      await jamaat.save();
    }

    const changed = {};
    for (const f of fields) {
      const old = before && before.values ? before.values[f.key] : undefined;
      if ((old || null) !== (values[f.key] || null)) changed[f.label] = { from: old || null, to: values[f.key] || null };
    }
    if ((before ? before.remarks || "" : "") !== remarks) changed.remarks = { from: before ? before.remarks || "" : null, to: remarks };

    audit(req, "entry_submitted", {
      details: {
        month, jamiat: jamiat.name, jamaat: jamaat.name,
        firstSubmission: !before, changed,
        ...(Object.keys(detailChanges).length ? { jamaatDetails: detailChanges } : {}),
      },
    });

    res.json({ ok: true, firstSubmission: !before, updatedAt: entry.updatedAt, details: details(jamaat) });
  } catch (err) {
    sendError(err, res, next, "This Jamaat was saved by someone else at the same moment. Please submit again.");
  }
});

module.exports = router;
