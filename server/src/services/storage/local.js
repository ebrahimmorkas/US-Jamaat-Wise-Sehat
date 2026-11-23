// Files kept on this server's disk (folder LOCAL_UPLOAD_DIR, default server/uploads).
// Private files open through /api/files/<key>?e=<expiry>&s=<signature> (links expire like ImageKit's);
// public ones (images inside emails) are under "public/" and open without a signature.
// NOTE: on Render the disk is wiped at every restart / deploy unless a Render Disk is attached.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../../config");
const { StorageError, uniqueName, cleanFolder, sizeOf, shrink } = require("./common");

const PREFIX = "local:";
const dir = () => path.resolve(config.storage.local.dir || path.join(__dirname, "..", "..", "..", "uploads"));
const configured = () => !!config.storage.local.on;
const secret = () => config.storage.linkSecret || crypto.createHmac("sha256", config.jwtAccessSecret).update("storage-local-links").digest("hex");

/** The website address the links start with (files go through the website's /api like every call). */
function base() {
  const site = config.forms.publicUrl || (config.corsOrigins || [])[0] || "";
  return String(site).replace(/\/+$/, "");
}
const keyOf = (fileId) => String(fileId || "").slice(PREFIX.length);
/** The file on disk for a key, or null when the key tries to leave the folder. */
function fileOf(key) {
  const root = dir();
  const p = path.resolve(root, String(key || ""));
  return p.startsWith(root + path.sep) ? p : null;
}
const encKey = (key) => key.split("/").map(encodeURIComponent).join("/");
const sig = (key, e, w, h, j) => crypto.createHmac("sha256", secret()).update(`${key}|${e}|${w || ""}|${h || ""}|${j ? 1 : ""}`).digest("hex").slice(0, 32);

async function upload(buffer, { fileName, type, folder, isPublic = false }) {
  const key = [isPublic ? "public" : "", cleanFolder(folder), uniqueName(fileName)].filter(Boolean).join("/");
  const p = fileOf(key);
  if (!p) throw new StorageError("The file name isn't allowed.", 400);
  try {
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.part`;
    await fs.promises.writeFile(tmp, buffer);
    await fs.promises.rename(tmp, p);
  } catch (e) {
    throw new StorageError(`The file couldn't be saved on the server (${e.code || "disk error"}).`, 507);
  }
  const { width, height } = await sizeOf(buffer, type);
  return { fileId: PREFIX + key, filePath: key, url: `${base()}/api/files/${encKey(key)}`, endpoint: `${base()}/api/files`, width, height };
}

async function remove(fileId) {
  const p = fileOf(keyOf(fileId));
  if (!p) return;
  await fs.promises.unlink(p).catch((e) => { if (e.code !== "ENOENT") throw new StorageError("The file couldn't be removed from the server. Try again."); });
}

function link(key, hours, v = {}) {
  const u = `${base()}/api/files/${encKey(key)}`;
  if (key.startsWith("public/") && !v.w) return u;
  const e = Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
  const q = new URLSearchParams({ e: String(e), ...(v.w ? { w: String(v.w), h: String(v.h || v.w) } : {}), ...(v.jpg ? { j: "1" } : {}), s: sig(key, e, v.w, v.h || v.w, v.jpg) });
  return `${u}?${q}`;
}
const url = (f, hours) => link(keyOf(f.fileId), hours);
const variant = (f, v, hours) => link(keyOf(f.fileId), hours, { w: v.w, h: v.h || v.w, jpg: !!v.jpg });

/** Reads the file straight from disk (no link needed). */
async function read(f) {
  const p = fileOf(keyOf(f.fileId));
  if (!p) throw new StorageError("File not found.", 404);
  try { return { bytes: await fs.promises.readFile(p), type: f.type || "" }; } catch { throw new StorageError("The file is no longer on the server (files kept on the server are lost when it restarts without a disk).", 404); }
}

/**
 * Checks a /api/files link. Returns { file, w, h, jpg } or null (bad / expired signature, or not found).
 * @param {string} key  the path after /api/files/
 * @param {object} q    the query (e, s, w, h, j)
 */
function check(key, q) {
  const p = fileOf(key);
  if (!p || !configuredDirHas(p)) return null;
  const w = Number(q.w) || 0;
  const h = Number(q.h) || 0;
  const jpg = q.j === "1";
  if (key.startsWith("public/") && !w) return { file: p, w: 0, h: 0, jpg: false };
  const e = Number(q.e);
  if (!e || e < Date.now() / 1000) return null;
  const want = sig(key, e, w || undefined, h || undefined, jpg);
  const got = String(q.s || "");
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
  if (w && (w > 4000 || h > 4000)) return null;
  return { file: p, w, h, jpg };
}
const configuredDirHas = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

module.exports = {
  label: "Local (on the server)",
  configured,
  needs: ["LOCAL_UPLOADS=true", "LOCAL_UPLOAD_DIR (the mount path of a Render Disk, e.g. /var/data/uploads)"],
  resizes: true, // done by this server (sharp) when the link asks for it
  expires: true,
  upload, remove, url, variant, read, check, shrink, dir,
  origins: () => [],
};
