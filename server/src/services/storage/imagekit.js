// ImageKit (imagekit.io): private files, signed links that expire, resizing on the fly (?tr=…).
// Plain HTTPS calls (no SDK). Only the server knows the private key.
// File ids are ImageKit's own ids (no prefix: every file saved before providers could be switched is ImageKit).
const crypto = require("crypto");
const config = require("../../config");
const { StorageError } = require("./common");

const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
const API_URL = "https://api.imagekit.io/v1";

const configured = () => !!config.imagekit.privateKey;
const auth = () => "Basic " + Buffer.from(config.imagekit.privateKey + ":").toString("base64");

async function call(url, options, what) {
  let res;
  try {
    res = await fetch(url, { ...options, headers: { Authorization: auth(), ...(options.headers || {}) }, signal: AbortSignal.timeout(60000) });
  } catch {
    throw new StorageError(`Couldn't reach ImageKit to ${what}. Try again.`);
  }
  if (res.status === 401 || res.status === 403) throw new StorageError("ImageKit refused the keys. Check the ImageKit keys on the server.", 503);
  return res;
}

/** Uploads a file (private unless isPublic). */
async function upload(buffer, { fileName, type, folder, isPublic = false }) {
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type }), fileName);
  fd.append("fileName", fileName);
  fd.append("folder", folder || config.imagekit.folder);
  fd.append("isPrivateFile", isPublic ? "false" : "true"); // public only for images shown inside emails
  fd.append("useUniqueFileName", "true");
  const res = await call(UPLOAD_URL, { method: "POST", body: fd }, "upload the file");
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.fileId || !out.url || !out.filePath) throw new StorageError(`ImageKit didn't accept the file${out.message ? `: ${out.message}` : ""}.`);
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
async function remove(fileId) {
  const res = await call(`${API_URL}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, "remove the file");
  if (!res.ok && res.status !== 404) throw new StorageError("ImageKit didn't remove the file. Try again.");
}

/** A link that opens a private file until it expires (ImageKit's "ik-t" / "ik-s" signature). */
function sign(url, endpoint, hours) {
  const expires = Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
  const base = (endpoint || config.imagekit.urlEndpoint).replace(/\/+$/, "");
  const signature = crypto.createHmac("sha1", config.imagekit.privateKey).update(url.replace(base + "/", "") + expires).digest("hex");
  return `${url}${url.includes("?") ? "&" : "?"}ik-t=${expires}&ik-s=${signature}`;
}
const url = (f, hours) => sign(f.url, f.endpoint, hours);

/** A smaller copy, made by ImageKit: fits inside w x h, never cropped (JPEG when asked). */
function variant(f, { w, h, jpg = false, quality = 82 }, hours) {
  const tr = [`w-${w}`, `h-${h || w}`, "c-at_max", ...(jpg ? ["f-jpg", `q-${quality}`] : [])].join(",");
  return sign(`${f.url}${f.url.includes("?") ? "&" : "?"}tr=${tr}`, f.endpoint, hours);
}

function origins() {
  const list = new Set(["https://ik.imagekit.io"]);
  try { if (/^https:\/\//.test(config.imagekit.urlEndpoint)) list.add(new URL(config.imagekit.urlEndpoint).origin); } catch { /* ignore */ }
  return [...list];
}

module.exports = {
  label: "ImageKit",
  configured,
  needs: ["IMAGEKIT_PRIVATE_KEY", "IMAGEKIT_PUBLIC_KEY", "IMAGEKIT_URL_ENDPOINT (e.g. https://ik.imagekit.io/your_id)"],
  resizes: true,
  expires: true,
  upload, remove, url, variant, origins,
};
