// The visitor's IP address (used for audit logs and rate limiting).
// In production the request passes Vercel -> Cloudflare -> Render (2 hops), so "trust proxy"
// is set to 4 hops (TRUST_PROXY_HOPS) and Express resolves req.ip to the visitor's address.
function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

module.exports = { clientIp };
