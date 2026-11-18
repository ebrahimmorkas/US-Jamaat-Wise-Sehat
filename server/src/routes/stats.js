// "Stats": an image the Super Admin uploads, shown on every portal with the history of earlier images.
//   Everyone signed in: GET /  (list, newest first = current; each with a signed ImageKit link that expires)
//   Super Admin:        POST / (raw image body, X-File-Name, ?title=), DELETE /:id
// The pictures are private files in ImageKit (services/imagekit.js).
const express = require("express");
const { isDbReady } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const StatImage = require("../models/StatImage");
const { audit } = require("../services/audit");
const { InputError, requireId, sendError } = require("../lib/validate");
const { publish } = require("../realtime");
const { TOPICS, EVENTS } = require("../realtime/topics");
const storage = require("../services/imagekit");

const MAX_IMAGE = 8 * 1024 * 1024;
const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  if (!isDbReady()) return res.status(503).json({ error: "Database is starting, please try again in a moment." });
  next();
});

// The file's own bytes decide its type (not its name).
function imageType(b) {
  if (b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.length > 6 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6))) return "image/gif";
  return "";
}
const out = (s) => ({
  id: String(s._id), title: s.title || "", fileName: s.fileName || "", type: s.type, size: s.size,
  width: s.width || 0, height: s.height || 0, uploadedAt: s.createdAt,
  src: storage.signedUrl(s), // opens the private picture for LINK_HOURS
});
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const changed = () => {
  publish(TOPICS.dashboard, EVENTS.statsChanged, { reason: "stats" });
  publish(TOPICS.portal, EVENTS.statsChanged, { reason: "stats" });
};
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

router.get("/", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const list = await StatImage.find({}).sort({ createdAt: -1 }).lean();
    res.json({ images: list.map(out), linkHours: storage.LINK_HOURS, ready: storage.ready() });
  } catch (err) { next(err); }
});

router.post("/", requireRole("superadmin"), express.raw({ type: "application/octet-stream", limit: MAX_IMAGE }), async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new InputError("Choose an image to upload.");
    const type = imageType(req.body);
    if (!type) throw new InputError("This file is not a picture. Upload a PNG, JPG, WebP or GIF image.");
    let fileName = "";
    try { fileName = clean(decodeURIComponent(String(req.get("x-file-name") || "")), 150); } catch { /* keep empty */ }
    const title = clean(req.query.title, 150);
    const stamp = new Date().toISOString().slice(0, 10);
    const kept = await storage.uploadImage(req.body, { fileName: `stats-${stamp}.${EXT[type]}`, type });
    let s;
    try {
      s = await StatImage.create({ title, fileName, type, size: req.body.length, ...kept, uploadedBy: req.user.id });
    } catch (err) {
      storage.deleteImage(kept.fileId).catch(() => {}); // don't leave an unlisted file behind
      throw err;
    }
    audit(req, "stats_uploaded", { target: { type: "stats", id: String(s._id), label: title || fileName || "Stats image" }, details: { size: s.size, type } });
    changed();
    res.status(201).json(out(s));
  } catch (err) {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "The image is too large. The limit is 8 MB." });
    if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
    sendError(err, res, next);
  }
});

router.delete("/:id", requireRole("superadmin"), async (req, res, next) => {
  try {
    const id = requireId(req.params.id, "image");
    const s = await StatImage.findById(id).lean();
    if (!s) throw new InputError("This image was already removed. Reload the page.", 404);
    await storage.deleteImage(s.fileId); // first: if ImageKit fails, the image stays listed (try again)
    await StatImage.deleteOne({ _id: id });
    audit(req, "stats_deleted", { target: { type: "stats", id: String(id), label: s.title || s.fileName || "Stats image" }, details: { uploadedAt: s.createdAt } });
    changed();
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof storage.StorageError) return res.status(err.status).json({ error: err.message });
    sendError(err, res, next);
  }
});

module.exports = router;
