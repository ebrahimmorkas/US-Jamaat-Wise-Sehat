// Best guess at the visitor's IP address (used for audit logs and rate limiting).
// With "trust proxy" set to the number of proxies (Vercel + Render), Express resolves req.ip.
function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

module.exports = { clientIp };
