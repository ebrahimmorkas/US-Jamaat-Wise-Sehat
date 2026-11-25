// Where uploaded images and files are kept: a provider that can be switched at any time (like email).
//
//   imagekit    ImageKit. The DEFAULT, and the BACKUP: if another provider fails or isn't set up, the file
//               is saved in ImageKit instead.
//   local       on this server's disk (needs a Render Disk in production, else files are lost on restart).
//   s3          Amazon S3 (or S3-compatible: R2, Wasabi, MinIO).
//   cloudinary  Cloudinary.
//
// Which one saves NEW files: the Super Admin's choice in the portal (Settings → Image storage), else
// STORAGE_PROVIDER, else ImageKit. Every saved file remembers its provider (in its file id), so links,
// downloads and deletes always go to the right place and switching never breaks older files.
// Keys are only in the server settings, never in the database or the website.
// To add a provider later: add a module with configured(), upload(), remove(), url() (+ variant(), read())
// and list it in PROVIDERS — nothing else changes.
const config = require("../../config");
const AppSetting = require("../../models/AppSetting");
const { StorageError, shrink } = require("./common");

const PROVIDERS = {
  imagekit: require("./imagekit"),
  local: require("./local"),
  s3: require("./s3"),
  cloudinary: require("./cloudinary"),
};
const NAMES = Object.keys(PROVIDERS);
const DEFAULT = "imagekit";
const LINK_HOURS = 12; // a page reloads the list (new links) when a link has expired
const KEY = "storage.provider";

/** The provider that holds a file (from its id; no prefix = ImageKit, as before providers could be switched). */
function providerOf(f) {
  const id = String((f && typeof f === "object" ? f.fileId : f) || "");
  if (id.startsWith("local:")) return "local";
  if (id.startsWith("s3:")) return "s3";
  if (id.startsWith("cld:")) return "cloudinary";
  return "imagekit";
}

// ---------- which provider saves new files ----------
let cache = { name: null, at: 0 };
async function activeName() {
  if (Date.now() - cache.at > 30000) {
    let chosen = null;
    try { const s = await AppSetting.findOne({ key: KEY }).lean(); chosen = s ? s.value : null; } catch { /* db not ready */ }
    cache = { name: chosen, at: Date.now() };
  }
  const env = config.storage.provider;
  return PROVIDERS[cache.name] ? cache.name : PROVIDERS[env] ? env : DEFAULT;
}
async function setActive(name, by) {
  if (!PROVIDERS[name]) throw new StorageError("Unknown image storage.", 400);
  await AppSetting.updateOne({ key: KEY }, { $set: { value: name, updatedBy: by } }, { upsert: true });
  cache = { name, at: Date.now() };
}
async function status() {
  const active = await activeName();
  return {
    active, fallback: DEFAULT,
    providers: NAMES.map((n) => { const p = PROVIDERS[n]; return { name: n, label: p.label, configured: p.configured(), needs: p.needs, resizes: p.resizes, expires: p.expires }; }),
  };
}

/** Can files be saved at all (the active provider as last read, or the backup)? */
function ready() {
  const n = PROVIDERS[cache.name] ? cache.name : PROVIDERS[config.storage.provider] ? config.storage.provider : DEFAULT;
  return PROVIDERS[n].configured() || PROVIDERS[DEFAULT].configured();
}

/**
 * Saves a file with the active provider; if it isn't set up or fails, with ImageKit (the backup).
 * @param {Buffer} buffer
 * @param {{ fileName: string, type: string, folder?: string, isPublic?: boolean }} opt  isPublic: images inside emails
 * @param {{ provider?: string }} [force]  one provider only, no backup (the settings page's test)
 * @returns {Promise<{ fileId, filePath, url, endpoint, width, height, provider }>}
 */
async function uploadImage(buffer, opt, force = {}) {
  if (force.provider) {
    const p = PROVIDERS[force.provider];
    if (!p || !p.configured()) throw new StorageError(`${p ? p.label : "That storage"} isn't set up on the server.`, 503);
    return { ...(await p.upload(buffer, opt)), provider: force.provider };
  }
  const first = await activeName();
  let error;
  if (PROVIDERS[first].configured()) {
    try { return { ...(await PROVIDERS[first].upload(buffer, opt)), provider: first }; } catch (e) { error = e; }
  } else error = new StorageError(`${PROVIDERS[first].label} isn't set up on the server.`, 503);
  if (first !== DEFAULT && PROVIDERS[DEFAULT].configured()) {
    console.warn(`[storage] ${PROVIDERS[first].label}: ${error.message} Saving in ${PROVIDERS[DEFAULT].label} instead.`);
    return { ...(await PROVIDERS[DEFAULT].upload(buffer, opt)), provider: DEFAULT };
  }
  if (first === DEFAULT && !PROVIDERS[DEFAULT].configured()) throw new StorageError("Image storage is not set up yet (no storage keys on the server).", 503);
  throw error;
}

/** Removes a file from wherever it was saved (already gone = fine). */
async function deleteImage(fileId) {
  if (!fileId) return;
  const p = PROVIDERS[providerOf(fileId)];
  if (!p.configured() && providerOf(fileId) !== "local") throw new StorageError(`${p.label} isn't set up on the server, so the file can't be removed.`, 503);
  await p.remove(fileId);
}

/** A link that opens the file (private files: signed, expiring after `hours` where the provider allows). "" = can't. */
function signedUrl(f, hours = LINK_HOURS) {
  if (!f || !f.url) return "";
  const name = providerOf(f);
  if (name !== "local" && !PROVIDERS[name].configured()) return "";
  return PROVIDERS[name].url(f, hours);
}

/** The lasting address of a PUBLIC file (images inside emails: email apps can't use expiring links). */
function publicUrl(f) {
  return providerOf(f) === "s3" ? PROVIDERS.s3.url(f, 0) : f.url;
}

/** A link to a smaller copy that fits inside w x h (never cropped; JPEG when `jpg`). S3: the original. */
function variantUrl(f, v, hours = LINK_HOURS) {
  if (!f || !f.url) return "";
  const name = providerOf(f);
  const p = PROVIDERS[name];
  if (name !== "local" && !p.configured()) return "";
  return p.variant ? p.variant(f, v, hours) : p.url(f, hours);
}

/**
 * The file's bytes, read on the server (reports, email attachments, downloads).
 * @param {object} f  the saved file
 * @param {{ w: number, h?: number, jpg?: boolean, quality?: number }} [v]  a smaller copy (made here when the provider can't)
 * @returns {Promise<{ bytes: Buffer, type: string }>}
 */
async function readFile(f, v = null) {
  const name = providerOf(f);
  const p = PROVIDERS[name];
  if (name !== "local" && !p.configured()) throw new StorageError(`${p.label} isn't set up on the server, so the file can't be read.`, 503);
  // Made smaller by the provider itself
  if (v && p.resizes && name !== "local") return fetchBytes(p.variant(f, v, 1), f);
  const got = p.read ? await p.read(f) : await fetchBytes(p.url(f, 1), f);
  if (!v) return got;
  try { return await shrink(got.bytes, v); } catch { return got; } // not an image sharp can read: as it is
}
async function fetchBytes(link, f) {
  let res;
  try { res = await fetch(link, { signal: AbortSignal.timeout(60000) }); } catch { throw new StorageError("Couldn't reach the image storage. Try again."); }
  if (!res.ok) throw new StorageError(`The image storage didn't send the file (${res.status}). Try again.`);
  return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || (f && f.type) || "" };
}

/** Origins the website must allow images / videos from (CSP): every provider, so older files keep opening. */
function imageOrigins() {
  return [...new Set(NAMES.flatMap((n) => PROVIDERS[n].origins()))];
}

module.exports = {
  ready, uploadImage, deleteImage, signedUrl, publicUrl, variantUrl, readFile, imageOrigins, providerOf,
  status, setActive, activeName, PROVIDERS, NAMES, DEFAULT, StorageError, LINK_HOURS,
};
