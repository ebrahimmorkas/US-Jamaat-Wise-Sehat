// Cloudinary (cloudinary.com). Plain HTTPS calls (no SDK), signed with the API secret.
// Private files are uploaded as "authenticated": they open only through a signed link made by this server.
// Cloudinary's signed links don't expire (expiring links need its paid "token" add-on), but they can't be guessed.
// Cloudinary makes smaller copies itself (c_limit, f_jpg).
const crypto = require("crypto");
const config = require("../../config");
const { StorageError, cleanFolder } = require("./common");

const PREFIX = "cld:"; // fileId = cld:<resource type>:<delivery type>:<public id>
const c = () => config.storage.cloudinary;
const configured = () => !!(c().cloudName && c().apiKey && c().apiSecret);
const API = () => `https://api.cloudinary.com/v1_1/${encodeURIComponent(c().cloudName)}`;
const DELIVERY = () => `https://res.cloudinary.com/${c().cloudName}`;

/** Signature of API parameters: sha1("a=1&b=2" + secret). */
function signParams(params) {
  const s = Object.keys(params).filter((k) => params[k] !== "" && params[k] != null).sort().map((k) => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(s + c().apiSecret).digest("hex");
}
function parse(fileId) {
  const m = /^cld:([a-z]+):([a-z]+):(.+)$/.exec(String(fileId || ""));
  return m ? { resource: m[1], type: m[2], publicId: m[3] } : null;
}

async function post(path, params, file) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const all = { ...params, timestamp };
  const fd = new FormData();
  if (file) fd.append("file", file.blob, file.name);
  for (const [k, v] of Object.entries(all)) fd.append(k, v);
  fd.append("api_key", c().apiKey);
  fd.append("signature", signParams(all));
  let res;
  try { res = await fetch(`${API()}${path}`, { method: "POST", body: fd, signal: AbortSignal.timeout(120000) }); } catch { throw new StorageError("Couldn't reach Cloudinary. Try again."); }
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new StorageError("Cloudinary refused the keys. Check the Cloudinary keys on the server.", 503);
  if (!res.ok) throw new StorageError(`Cloudinary didn't accept it${out.error && out.error.message ? `: ${out.error.message}` : ""}.`);
  return out;
}

async function upload(buffer, { fileName, type, folder, isPublic = false }) {
  const out = await post("/auto/upload", { folder: cleanFolder(folder), type: isPublic ? "upload" : "authenticated" }, { blob: new Blob([buffer], { type }), name: fileName });
  if (!out.public_id || !out.secure_url) throw new StorageError("Cloudinary didn't accept the file.");
  const tail = `${out.public_id}${out.format && out.resource_type !== "raw" ? `.${out.format}` : ""}`;
  return {
    fileId: `${PREFIX}${out.resource_type}:${out.type}:${out.public_id}`,
    filePath: `v${out.version}/${tail}`, // version + public id (+ format)
    url: out.secure_url,
    endpoint: DELIVERY(),
    width: out.width || 0,
    height: out.height || 0,
  };
}

async function remove(fileId) {
  const p = parse(fileId);
  if (!p) return;
  const out = await post(`/${p.resource}/destroy`, { public_id: p.publicId, type: p.type, invalidate: "true" });
  if (out.result && !["ok", "not found"].includes(out.result)) throw new StorageError("Cloudinary didn't remove the file. Try again.");
}

/** A delivery link; private ("authenticated") ones carry the s--signature--. */
function deliver(f, transformation = "") {
  const p = parse(f.fileId);
  if (!p) return f.url || "";
  const [version, ...rest] = String(f.filePath || "").split("/");
  const tail = rest.join("/");
  const tr = transformation ? `${transformation}/` : "";
  if (p.type === "upload" && !transformation) return f.url;
  const signed = p.type === "upload" ? "" : `s--${crypto.createHash("sha1").update(`${tr}${tail}${c().apiSecret}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").slice(0, 8)}--/`;
  return `${DELIVERY()}/${p.resource}/${p.type}/${signed}${tr}${version}/${tail}`;
}
const url = (f) => deliver(f);
function variant(f, { w, h, jpg = false, quality = 82 }) {
  const p = parse(f.fileId);
  if (!p || p.resource !== "image") return deliver(f);
  return deliver(f, [`c_limit`, `h_${h || w}`, `w_${w}`, ...(jpg ? ["f_jpg", `q_${quality}`] : [])].join(","));
}

module.exports = {
  label: "Cloudinary",
  configured,
  needs: ["CLOUDINARY_URL (cloudinary://<API key>:<API secret>@<cloud name>), or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET"],
  resizes: true,
  expires: false,
  upload, remove, url, variant,
  origins: () => ["https://res.cloudinary.com"],
  _test: { deliver, signParams },
};
