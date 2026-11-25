// Image storage provider (Super Admin only): /api/storage
//   GET  /settings   the providers (set up on the server or not), which one saves new files, the backup
//   PUT  /settings   { provider: "imagekit" | "local" | "s3" | "cloudinary" }  (must be set up on the server)
//   POST /test       { provider } -> saves a small test picture there, reads it back, removes it
const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { audit } = require("../services/audit");
const { InputError, sendError } = require("../lib/validate");
const storage = require("../services/storage");

const router = express.Router();
router.use(requireAuth, requireRole("superadmin"), (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

const nameOf = (b) => {
  const name = String((b || {}).provider || "");
  if (!storage.PROVIDERS[name]) throw new InputError("Choose ImageKit, Local, Amazon S3 or Cloudinary.");
  return name;
};

router.get("/settings", async (req, res, next) => {
  try { res.json(await storage.status()); } catch (err) { sendError(err, res, next); }
});

router.put("/settings", async (req, res, next) => {
  try {
    const name = nameOf(req.body);
    const p = storage.PROVIDERS[name];
    if (!p.configured()) throw new InputError(`${p.label} isn't set up on the server yet. Add its settings on Render first.`, 409);
    const before = await storage.activeName();
    await storage.setActive(name, req.user.email);
    audit(req, "storage_settings_changed", { target: { type: "settings", id: "storage.provider", label: "Image storage" }, changes: [{ field: "provider", label: "Image storage", from: before, to: name }] });
    res.json(await storage.status());
  } catch (err) { sendError(err, res, next); }
});

let testing = false;
router.post("/test", async (req, res, next) => {
  let saved = null;
  let mine = false; // this request holds the "testing" flag
  const name = (() => { try { return nameOf(req.body); } catch (e) { return e; } })();
  try {
    if (name instanceof Error) throw name;
    if (testing) throw new InputError("A test is already running. Try again in a moment.", 429);
    testing = true;
    mine = true;
    const p = storage.PROVIDERS[name];
    const started = Date.now();
    const png = await require("sharp")({ create: { width: 40, height: 24, channels: 3, background: { r: 31, g: 110, b: 67 } } }).png().toBuffer();
    const step = async (what, fn) => { try { return await fn(); } catch (e) { throw new InputError(`${p.label}: couldn't ${what} — ${String((e && e.message) || e).slice(0, 300)}`, 502); } };
    saved = await step("save the test picture", () => storage.uploadImage(png, { fileName: "storage-test.png", type: "image/png", folder: "/umoor-sehhat/storage-test" }, { provider: name }));
    const back = await step("read the test picture back", () => storage.readFile(saved));
    if (!back.bytes || !back.bytes.length) throw new InputError(`${p.label}: the picture read back was empty.`, 502);
    const small = await step("make a smaller copy", () => storage.readFile(saved, { w: 20, h: 20, jpg: true }));
    await step("remove the test picture", () => storage.deleteImage(saved.fileId));
    saved = null;
    audit(req, "storage_tested", { target: { type: "settings", id: "storage.provider", label: "Image storage" }, details: { provider: name, ok: true } });
    res.json({ ok: true, provider: name, ms: Date.now() - started, resized: small.bytes.length > 0 && small.bytes[0] === 0xff });
  } catch (err) {
    if (!(name instanceof Error)) audit(req, "storage_tested", { success: false, target: { type: "settings", id: "storage.provider", label: "Image storage" }, details: { provider: name, ok: false, error: String(err.message || err).slice(0, 300) } });
    sendError(err, res, next);
  } finally {
    if (saved) storage.deleteImage(saved.fileId).catch(() => {});
    if (mine) testing = false;
  }
});

module.exports = router;
