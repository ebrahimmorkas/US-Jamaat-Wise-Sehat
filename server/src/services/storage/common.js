// Shared bits of the image / file storage providers.
const crypto = require("crypto");
const path = require("path");

class StorageError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; this.expose = true; }
}

/** A safe, unique file name: "<random>-<name>.<ext>" (letters, digits, - _ . only). */
function uniqueName(fileName) {
  const ext = (path.extname(String(fileName || "")).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [""])[0];
  const base = path.basename(String(fileName || "file"), path.extname(String(fileName || ""))).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  return `${crypto.randomBytes(6).toString("hex")}-${base}${ext}`;
}

/** "/umoor-sehhat/forms/abc" -> "umoor-sehhat/forms/abc" (no leading / trailing slashes, no "..", safe characters). */
function cleanFolder(folder) {
  return String(folder || "").split("/").map((s) => s.replace(/[^A-Za-z0-9_.-]+/g, "-")).filter((s) => s && s !== "." && s !== "..").join("/");
}

/** Width / height of an image (0 when it isn't one sharp can read). */
async function sizeOf(buffer, type) {
  if (!/^image\//.test(type || "")) return { width: 0, height: 0 };
  try {
    const m = await require("sharp")(buffer, { failOn: "none" }).metadata();
    const turned = m.orientation >= 5; // EXIF says it is shown turned by 90°
    return { width: (turned ? m.height : m.width) || 0, height: (turned ? m.width : m.height) || 0 };
  } catch { return { width: 0, height: 0 }; }
}

/** A smaller JPEG / the same type, made on this server (for providers that can't resize). */
async function shrink(buffer, { w, h, jpg = false, quality = 82 }) {
  const sharp = require("sharp");
  let img = sharp(buffer, { failOn: "none", animated: false }).rotate().resize({ width: w, height: h || w, fit: "inside", withoutEnlargement: true });
  if (jpg) img = img.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true });
  const out = await img.toBuffer({ resolveWithObject: true });
  return { bytes: out.data, type: `image/${out.info.format === "jpeg" ? "jpeg" : out.info.format}` };
}

module.exports = { StorageError, uniqueName, cleanFolder, sizeOf, shrink };
