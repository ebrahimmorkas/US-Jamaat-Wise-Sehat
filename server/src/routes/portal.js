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
const { activeFields, formFields, activitiesFor, portalShape } = require("../services/fields");
const { commentsFor, commentedKeys } = require("../services/comments");
const { clientIp } = require("../lib/clientIp");
const realtime = require("../realtime");
const { notDeleted } = require("../lib/softDelete");
const { TOPICS, EVENTS } = require("../realtime/topics");
const { monthLabel, monthInfo, portalMonths } = require("../lib/month");
const { InputError, requireId, parseValues, parseComments, parseRemarks, sendError } = require("../lib/validate");

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

// Jamaat details are shown to the JC read-only; only the Super Admin changes them (Masters).
const details = (jm) => ({
  mauzeType: jm.mauzeType || "",
  houseCount: jm.houseCount == null ? null : jm.houseCount,
});

// The portal never changes Jamaat details. A request that still tries to (e.g. someone
// re-enabled the locked fields in the browser) is refused and logged as access denied.
const LOCKED = { mauzeType: "Mauze Type", houseCount: "House Count", children: "Children" };
const asText = (v) => (v == null ? "" : String(v).trim());
function lockedChanges(sent, jm) {
  if (sent === undefined) return [];
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) return [{ field: "jamaat.details", label: "Jamaat details", from: null, to: String(sent).slice(0, 100) }];
  const out = [];
  for (const [k, v] of Object.entries(sent).slice(0, 20)) {
    const now = k in LOCKED ? jm[k] : undefined;
    if (asText(v).toLowerCase() !== asText(now).toLowerCase()) {
      out.push({ field: `jamaat.${String(k).slice(0, 40)}`, label: LOCKED[k] || String(k).slice(0, 40), from: now == null ? null : now, to: asText(v).slice(0, 100) || null });
    }
  }
  return out;
}

// The JC's assigned Jamaats (active, inside an assigned active Jamiat): [{ jm, jamiat }]
function myJamaats(masters, access) {
  const mine = [];
  for (const j of masters) {
    if (!access.jamiats.has(String(j._id))) continue;
    for (const jm of j.jamaats) if (access.jamaats.has(String(jm._id))) mine.push({ jm, jamiat: j });
  }
  return mine;
}

function checkMonth(month) {
  if (!portalMonths().includes(month)) throw new InputError("Choose a valid month (not a future month).");
  return month;
}

// An active Jamaat inside an active Jamiat, assigned to this JC.
async function findJamaat(req, id) {
  const jm = await Jamaat.findOne({ _id: requireId(id, "Jamaat"), isActive: true, ...notDeleted() });
  const jt = jm && (await Jamiat.findOne({ _id: jm.jamiat, isActive: true, ...notDeleted() }).select("name").lean());
  if (!jm || !jt) throw new InputError("This Jamaat is not available. Reload the page.", 404);
  if (!canFill(await accessOf(req), jm)) {
    audit(req, "access_denied", { success: false, target: { type: "jamaat", id: String(jm._id), label: `${jm.name} (${jt.name})` }, details: { reason: "jamaat_not_assigned", method: req.method, path: req.originalUrl.slice(0, 300) } });
    throw new InputError("This Jamaat is not assigned to you.", 403);
  }
  return { jamaat: jm, jamiat: jt };
}

// ---------- GET /api/portal/options ----------  form questions + Jamiat/Jamaat lists
router.get("/options", async (req, res, next) => {
  try {
    const [masters, fields, access] = await Promise.all([activeMasters(), activeFields(), accessOf(req)]);
    res.json({
      months: portalMonths().map(monthInfo),
      fields: fields.map(portalShape),
      remarksLabel: form.remarksLabel,
      remarksMaxLength: form.remarksMaxLength,
      commentMaxLength: form.commentMaxLength,
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

// ---------- GET /api/portal/summary?month=YYYY-MM ----------  the JC's own dashboard
// (each activity of a monthly-activity question is a question of its own here)
// Only the Jamaats assigned to this JC, and for each only the dropdown answers (no comments,
// remarks or IPs). The page works out the counts itself.
router.get("/summary", async (req, res, next) => {
  try {
    const months = portalMonths();
    const month = req.query.month ? checkMonth(req.query.month) : months[0];
    const [masters, fields, access] = await Promise.all([activeMasters(), formFields(month), accessOf(req)]);
    const questions = fields.filter((f) => f.type === "select").map((f) => ({
      ...portalShape(f),
      done: f.options.filter((o) => o.meaning === "done").map((o) => o.value),
    }));
    const mine = myJamaats(masters, access);
    const entries = await Entry.find({ month, jamaat: { $in: mine.map((x) => x.jm._id) } }).select("jamaat values comments updatedAt").lean();
    const byJamaat = new Map(entries.map((e) => [String(e.jamaat), e]));
    res.json({
      month,
      monthLabel: monthLabel(month),
      months: months.map(monthInfo),
      questions,
      jamaats: mine.map(({ jm, jamiat }) => {
        const e = byJamaat.get(String(jm._id));
        const values = {};
        if (e) for (const q of questions) if (e.values && e.values[q.key]) values[q.key] = e.values[q.key];
        return { id: String(jm._id), name: jm.name, jamiatId: String(jamiat._id), jamiat: jamiat.name, submittedAt: e ? e.updatedAt : null, values, commented: commentedKeys(e) };
      }),
      loadedAt: new Date(),
    });
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- GET /api/portal/comments?month=YYYY-MM ----------  comments in the JC's own Jamaats
// Loaded only when the JC opens "Comments"; each opening is logged.
router.get("/comments", async (req, res, next) => {
  try {
    const month = req.query.month ? checkMonth(req.query.month) : portalMonths()[0];
    const [masters, access] = await Promise.all([activeMasters(), accessOf(req)]);
    const places = myJamaats(masters, access).map(({ jm, jamiat }) => ({ id: jm._id, name: jm.name, jamiatId: jamiat._id, jamiat: jamiat.name }));
    const body = await commentsFor(month, places);
    audit(req, "comments_viewed", { details: { month, count: body.comments.length } });
    res.json(body);
  } catch (err) {
    sendError(err, res, next);
  }
});

// ---------- GET /api/portal/entry?jamaat=<id>&month=YYYY-MM ----------  what is saved already
router.get("/entry", async (req, res, next) => {
  try {
    const month = checkMonth(req.query.month);
    const { jamaat } = await findJamaat(req, req.query.jamaat);
    const [entry, fields, acts] = await Promise.all([
      Entry.findOne({ jamaat: jamaat._id, month }).select("values comments remarks updatedAt").lean(),
      activeFields(),
      activitiesFor(month),
    ]);
    audit(req, "entry_viewed", { target: { type: "jamaat", id: String(jamaat._id), label: jamaat.name }, details: { month, saved: !!entry } });
    res.json({
      details: details(jamaat),
      // this month's activities of each monthly-activity question: { <field key>: [{ id, name }] }
      activities: Object.fromEntries(fields.filter((f) => f.hasActivities).map((f) => [f.key, (acts.get(f.key) || []).map(({ id, name }) => ({ id, name }))])),
      entry: entry ? { values: entry.values, comments: entry.comments || {}, remarks: entry.remarks || "", updatedAt: entry.updatedAt } : null,
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
    const fields = await formFields(month); // each activity of the month counts as a question
    const answers = parseValues(body.values, fields);
    const comments = parseComments(body.comments, fields);
    const remarks = parseRemarks(body.remarks);
    const { jamaat, jamiat } = await findJamaat(req, body.jamaatId);
    const jamaatTarget = { type: "jamaat", id: String(jamaat._id), label: `${jamaat.name} (${jamiat.name})` };

    const tampered = lockedChanges(body.details, jamaat);
    if (tampered.length) {
      audit(req, "access_denied", { success: false, target: jamaatTarget, changes: tampered, details: { reason: "locked_jamaat_details", method: req.method, path: req.originalUrl.slice(0, 300), month } });
      throw new InputError("Jamaat details can't be changed from the JC portal. Nothing was saved. Please reload the page.", 403);
    }

    const before = await Entry.findOne({ jamaat: jamaat._id, month }).select("values comments remarks").lean();
    // Keep answers / comments of questions that are inactive now; replace the ones on the form.
    const values = { ...((before && before.values) || {}) };
    const allComments = { ...((before && before.comments) || {}) };
    for (const f of fields) {
      if (f.key in answers) values[f.key] = answers[f.key];
      else delete values[f.key];
      if (f.key in comments) allComments[f.key] = comments[f.key];
      else if (f.hasComment) delete allComments[f.key];
    }
    const entry = await Entry.findOneAndUpdate(
      { jamaat: jamaat._id, month },
      { $set: { values, comments: allComments, remarks, lastIp: clientIp(req) }, $inc: { submitCount: 1 } },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
    );

    // Audit trail: only the answers that changed, with their previous value.
    const trail = [];
    const oldComments = (before && before.comments) || {};
    for (const f of fields) {
      const old = before && before.values ? before.values[f.key] : undefined;
      if ((old || null) !== (values[f.key] || null)) trail.push({ field: `values.${f.key}`, label: f.label, from: old || null, to: values[f.key] || null });
      if ((oldComments[f.key] || null) !== (allComments[f.key] || null)) {
        trail.push({ field: `comments.${f.key}`, label: `${f.label} (comment)`, from: oldComments[f.key] || null, to: allComments[f.key] || null });
      }
    }
    const oldRemarks = before ? before.remarks || "" : "";
    if (oldRemarks !== remarks) trail.push({ field: "remarks", label: "Remarks", from: oldRemarks || null, to: remarks || null });

    audit(req, "entry_submitted", {
      target: { ...jamaatTarget, type: "entry", id: `${jamaat._id}:${month}`, label: `${jamaatTarget.label} · ${monthLabel(month)}` },
      changes: trail,
      details: { month, jamiat: jamiat.name, jamaat: jamaat.name, firstSubmission: !before, unchanged: !trail.length || undefined },
    });

    // Open dashboards reload at once (only the month / Jamaat id is sent; they fetch the data themselves,
    // so each JC still sees only their own Jamaats).
    if (trail.length || !before) {
      realtime.publish(TOPICS.dashboard, EVENTS.dashboardChanged, { reason: "entry", month });
      realtime.publish(TOPICS.portal, EVENTS.portalChanged, { reason: "entry", month, jamaat: String(jamaat._id) });
    }

    res.json({ ok: true, firstSubmission: !before, updatedAt: entry.updatedAt, details: details(jamaat) });
  } catch (err) {
    sendError(err, res, next, "This Jamaat was saved by someone else at the same moment. Please submit again.");
  }
});

module.exports = router;
