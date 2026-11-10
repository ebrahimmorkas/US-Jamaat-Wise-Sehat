const express = require("express");
const AuditLog = require("../models/AuditLog");
const { ACTIONS } = require("../models/AuditLog");
const { audit } = require("../services/audit");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Events the website itself reports (everything else is logged by the server).
const CLIENT_EVENTS = new Set(["list_viewed"]);
const clean = (v) => (v == null ? undefined : String(v).slice(0, 120));

// Groups for the Super Admin's Logs page.
const CATEGORIES = {
  signin: ["login_success", "login_failed", "login_blocked", "account_locked", "logout", "token_reuse_detected"],
  changes: ["user_created", "user_updated", "user_deleted", "user_password_reset", "dropdown_updated", "field_created", "field_updated", "field_deleted", "entry_submitted", "master_created", "master_updated", "master_deleted"],
  access: ["access_denied"],
  activity: ["dashboard_opened", "admin_opened", "portal_opened", "data_refresh", "list_viewed", "entry_viewed", "audit_viewed"],
};

// ---------- POST /api/audit/event ----------
router.post("/event", requireAuth, requireRole("saheb"), (req, res) => {
  const { action, details = {} } = req.body || {};
  if (!CLIENT_EVENTS.has(action)) return res.status(400).json({ error: "Unknown event." });
  audit(req, action, {
    details: {
      metric: clean(details.metric),
      status: clean(details.status),
      jamiat: clean(details.jamiat),
      jamaat: clean(details.jamaat),
      count: Number.isFinite(details.count) ? details.count : undefined,
    },
  });
  res.status(204).end();
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (v, n = 100) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// ---------- GET /api/audit ----------  (Super Admin only)
// ?category=signin|changes|access|activity  &action=login_failed  &user=<text>  &q=<text in target/details>
// &targetType=jamaat &targetId=<id>  &from=<date> &to=<date>  &before=<date>  &limit=50 (max 200)
router.get("/", requireAuth, requireRole("superadmin"), async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const filter = {};
    const category = str(req.query.category, 20);
    const action = str(req.query.action, 40);
    if (action && ACTIONS.includes(action)) filter.action = action;
    else if (CATEGORIES[category]) filter.action = { $in: CATEGORIES[category] };
    else filter.action = { $ne: "token_refreshed" }; // very frequent; ask for it explicitly with action=

    const user = str(req.query.user, 120);
    if (user) filter.username = { $regex: escapeRegex(user), $options: "i" };
    const q = str(req.query.q);
    if (q) {
      const re = { $regex: escapeRegex(q), $options: "i" };
      filter.$or = [{ "target.label": re }, { "changes.label": re }, { "details.jamaat": re }, { "details.jamiat": re }, { "details.email": re }, { "details.label": re }, { "details.name": re }, { "details.page": re }, { "details.path": re }];
    }
    const targetType = str(req.query.targetType, 30);
    const targetId = str(req.query.targetId, 40);
    if (targetType) filter["target.type"] = targetType;
    if (targetId) filter["target.id"] = targetId;

    const at = {};
    for (const [k, op] of [["from", "$gte"], ["to", "$lte"], ["before", "$lt"]]) {
      const v = str(req.query[k], 40);
      if (v) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) at[op] = d;
      }
    }
    if (Object.keys(at).length) filter.at = at;

    const items = await AuditLog.find(filter).sort({ at: -1 }).limit(limit).select("-__v -user").lean();
    // Log only the first page of a search, not every "load more".
    if (!req.query.before) audit(req, "audit_viewed", { details: { category: category || undefined, action: action || undefined, user: user || undefined, q: q || undefined, count: items.length } });
    res.set("Cache-Control", "no-store");
    res.json({ items, next: items.length === limit ? items[items.length - 1].at : null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
