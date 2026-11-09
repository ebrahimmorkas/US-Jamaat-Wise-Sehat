// The visitor's IP address (used for audit logs and rate limiting).
// In production the request passes Vercel -> Cloudflare -> Render's load balancer, so
// "trust proxy" is set to 3 hops (TRUST_PROXY_HOPS) and Express resolves req.ip correctly.
function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

module.exports = { clientIp };
