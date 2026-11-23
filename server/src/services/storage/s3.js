// Amazon S3 (or any S3-compatible storage: Cloudflare R2, Wasabi, MinIO … via S3_ENDPOINT).
// Plain HTTPS calls signed with AWS Signature V4 (no SDK). Files are private; links are pre-signed and expire.
// S3 can't make smaller copies, so this server resizes when needed (reports, thumbnails are the original).
// Public files (images inside emails) need S3_PUBLIC_URL (a bucket / CDN address that allows reading
// the "public/" folder); without it they get a 7-day link (the longest S3 allows).
const crypto = require("crypto");
const config = require("../../config");
const { StorageError, uniqueName, cleanFolder, sizeOf } = require("./common");

const PREFIX = "s3:";
const MAX_SECONDS = 7 * 24 * 3600; // S3's limit for a pre-signed link
const c = () => config.storage.s3;
const configured = () => !!(c().bucket && c().region && c().accessKeyId && c().secretAccessKey);
const keyOf = (fileId) => String(fileId || "").slice(PREFIX.length);

const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
const encKey = (key) => key.split("/").map(enc).join("/");

/** Where a key lives: virtual-hosted AWS address, or path-style on a custom endpoint. */
function target(key, s = c()) {
  if (s.endpoint) {
    const u = new URL(s.endpoint);
    return { host: u.host, origin: u.origin, path: `${u.pathname.replace(/\/+$/, "")}/${enc(s.bucket)}/${encKey(key)}` };
  }
  const host = `${s.bucket}.s3.${s.region}.amazonaws.com`;
  return { host, origin: `https://${host}`, path: `/${encKey(key)}` };
}
function signingKey(secret, date, region) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
}
const stamp = (d) => d.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z

/** A signed request (upload / delete). */
async function request(method, key, { body, type } = {}) {
  const s = c();
  const t = target(key);
  const amzDate = stamp(new Date());
  const date = amzDate.slice(0, 8);
  const payload = sha(body || "");
  const headers = { host: t.host, "x-amz-content-sha256": payload, "x-amz-date": amzDate, ...(type ? { "content-type": type } : {}) };
  const names = Object.keys(headers).sort();
  const canonical = [method, t.path, "", names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${date}/${s.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canonical)].join("\n");
  const signature = hmac(signingKey(s.secretAccessKey, date, s.region), toSign).toString("hex");
  const { host, ...send } = headers; // fetch sets Host itself
  send.authorization = `AWS4-HMAC-SHA256 Credential=${s.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    return await fetch(t.origin + t.path, { method, headers: send, body, signal: AbortSignal.timeout(60000) });
  } catch {
    throw new StorageError("Couldn't reach S3. Try again.");
  }
}

/** A pre-signed GET link (works without keys until it expires). */
function presign(key, seconds, { s = c(), now = new Date() } = {}) {
  const t = target(key, s);
  const amzDate = stamp(now);
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${s.region}/s3/aws4_request`;
  const q = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${s.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(MAX_SECONDS, Math.max(1, Math.round(seconds)))),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join("&");
  const canonical = ["GET", t.path, query, `host:${t.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canonical)].join("\n");
  const signature = hmac(signingKey(s.secretAccessKey, date, s.region), toSign).toString("hex");
  return `${t.origin}${t.path}?${query}&X-Amz-Signature=${signature}`;
}

function failText(res, body) {
  const code = (/<Code>([^<]+)<\/Code>/.exec(body || "") || [])[1] || "";
  if (res.status === 403) return `S3 refused the keys${code ? ` (${code})` : ""}. Check the S3 keys and the bucket's permissions on the server.`;
  if (code === "NoSuchBucket") return "The S3 bucket wasn't found. Check S3_BUCKET and S3_REGION.";
  return `S3 didn't accept the file${code ? ` (${code})` : ` (${res.status})`}.`;
}

async function upload(buffer, { fileName, type, folder, isPublic = false }) {
  const key = [isPublic ? "public" : "", cleanFolder(folder), uniqueName(fileName)].filter(Boolean).join("/");
  const res = await request("PUT", key, { body: buffer, type: type || "application/octet-stream" });
  if (!res.ok) throw new StorageError(failText(res, await res.text().catch(() => "")), res.status === 403 ? 503 : 502);
  const { width, height } = await sizeOf(buffer, type);
  const t = target(key);
  return { fileId: PREFIX + key, filePath: key, url: t.origin + t.path, endpoint: t.origin, width, height };
}

async function remove(fileId) {
  const res = await request("DELETE", keyOf(fileId));
  if (!res.ok && res.status !== 404) throw new StorageError(failText(res, await res.text().catch(() => "")));
}

function url(f, hours) {
  const key = keyOf(f.fileId);
  if (key.startsWith("public/") && c().publicUrl) return `${c().publicUrl}/${encKey(key)}`;
  return presign(key, key.startsWith("public/") ? MAX_SECONDS : hours * 3600);
}

async function read(f) {
  let res;
  try { res = await fetch(presign(keyOf(f.fileId), 600), { signal: AbortSignal.timeout(60000) }); } catch { throw new StorageError("Couldn't reach S3. Try again."); }
  if (!res.ok) throw new StorageError(res.status === 404 ? "The file is no longer in S3." : failText(res, await res.text().catch(() => "")));
  return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || f.type || "" };
}

function origins() {
  const s = c();
  const list = new Set();
  try { if (s.bucket) list.add(new URL(target("x", s).origin).origin); } catch { /* not set up */ }
  try { if (s.publicUrl) list.add(new URL(s.publicUrl).origin); } catch { /* ignore */ }
  return [...list];
}

module.exports = {
  label: "Amazon S3",
  configured,
  needs: ["S3_BUCKET", "S3_REGION (e.g. ap-south-1)", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL (optional: address that opens the public/ folder, for images inside emails)", "S3_ENDPOINT (optional: only for R2 / Wasabi / other S3-compatible storage)"],
  resizes: false,
  expires: true,
  upload, remove, url, read, origins,
  _test: { presign, target },
};
