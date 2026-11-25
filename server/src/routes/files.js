// Files kept on this server (image storage "Local"): GET /api/files/<key>?e=&s=[&w=&h=&j=1]
// Only with a valid, unexpired signature made by the server (public "public/…" files: no signature).
// w / h: a smaller copy made here (fits inside, never cropped); j=1: as a JPEG.
const fs = require("fs");
const path = require("path");
const express = require("express");
const local = require("../services/storage/local");

const TYPES = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".pdf": "application/pdf",
};
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/|application\/pdf)/; // shown in the page; anything else is downloaded

const router = express.Router();
router.get("/*key", async (req, res) => {
  const key = (Array.isArray(req.params.key) ? req.params.key : [req.params.key]).join("/");
  const ok = local.check(key, req.query);
  if (!ok) return res.status(404).json({ error: "This link has expired or the file isn't here. Reload the page." });
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set("Cache-Control", key.startsWith("public/") ? "public, max-age=86400" : "private, max-age=3600");
  const type = TYPES[path.extname(ok.file).toLowerCase()] || "application/octet-stream";
  if (ok.w) {
    try {
      const out = await local.shrink(await fs.promises.readFile(ok.file), { w: ok.w, h: ok.h, jpg: ok.jpg });
      res.set("Content-Type", out.type);
      return res.send(out.bytes);
    } catch { /* not an image sharp can read: send it as it is */ }
  }
  res.set("Content-Type", type);
  res.set("Content-Disposition", `${INLINE.test(type) ? "inline" : "attachment"}; filename="${path.basename(ok.file).replace(/^[0-9a-f]{12}-/, "").replace(/"/g, "")}"`);
  return res.sendFile(ok.file, { dotfiles: "deny" }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

module.exports = router;
