// ImageKit (imagekit.io) for the Stats images: upload as PRIVATE files, signed links that expire, delete.
// Plain HTTPS calls (no SDK). Only the server knows the private key.
const crypto = require("crypto");
const config = require("../config");

const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
const API_URL = "https://api.imagekit.io/v1";
const LINK_HOURS = 12; // a page reloads the list (new links) when a link has expired

class StorageError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; this.expose = true; }
}

const ready = () => !!config.imagekit.privateKey;
const auth = () => "Basic " + Buffer.from(config.imagekit.privateKey + ":").toString("base64");

async function call(url, options, what) {
  let res;
  try {
    res = await fetch(url, { ...options, headers: { Authorization: auth(), ...(options.headers || {}) }, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new StorageError(`Couldn't reach the image storage to ${what}. Try again.`);
  }
  if (res.status === 401 || res.status === 403) throw new StorageError("The image storage refused the keys. Check the ImageKit keys on the server.", 503);
  return res;
}

/** Uploads a picture as a private file. Returns { fileId, filePath, url, endpoint, width, height }. */
async function uploadImage(buffer, { fileName, type }) {
  if (!ready()) throw new StorageError("Image storage is not set up yet (ImageKit keys missing on the server).", 503);
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type }), fileName);
  fd.append("fileName", fileName);
  fd.append("folder", config.imagekit.folder);
  fd.append("isPrivateFile", "true");
  fd.append("useUniqueFileName", "true");
  const res = await call(UPLOAD_URL, { method: "POST", body: fd }, "upload the image");
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.fileId || !out.url || !out.filePath) throw new StorageError(`The image storage didn't accept the image${out.message ? `: ${out.message}` : ""}.`);
  return {
    fileId: out.fileId,
    filePath: out.filePath,
    url: out.url,
    endpoint: out.url.slice(0, out.url.length - out.filePath.length), // e.g. https://ik.imagekit.io/<id>
    width: out.width || 0,
    height: out.height || 0,
  };
}

/** Removes a file (already gone = fine). */
async function deleteImage(fileId) {
  if (!fileId) return;
  if (!ready()) throw new StorageError("Image storage is not set up yet (ImageKit keys missing on the server).", 503);
  const res = await call(`${API_URL}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, "remove the image");
  if (!res.ok && res.status !== 404) throw new StorageError("The image storage didn't remove the image. Try again.");
}

/** A link that opens a private file until it expires (ImageKit's "ik-t" / "ik-s" signature). */
function signedUrl({ url, endpoint }, hours = LINK_HOURS) {
  if (!url || !ready()) return "";
  const expires = Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
  const base = (endpoint || config.imagekit.urlEndpoint).replace(/\/+$/, "");
  const signature = crypto.createHmac("sha1", config.imagekit.privateKey).update(url.replace(base + "/", "") + expires).digest("hex");
  return `${url}${url.includes("?") ? "&" : "?"}ik-t=${expires}&ik-s=${signature}`;
}

/** Origins the website must allow images from (CSP). */
function imageOrigins() {
  const list = new Set(["https://ik.imagekit.io"]);
  try { if (/^https:\/\//.test(config.imagekit.urlEndpoint)) list.add(new URL(config.imagekit.urlEndpoint).origin); } catch { /* ignore */ }
  return [...list];
}

module.exports = { ready, uploadImage, deleteImage, signedUrl, imageOrigins, StorageError, LINK_HOURS };
