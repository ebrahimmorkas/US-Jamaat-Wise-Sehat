// Best guess at the visitor's IP address (used for audit logs and rate limiting).
function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

// TEMPORARY: prints the proxy headers a few times so the right one can be chosen.
let logged = 0;
function logIpHeaders(req) {
  if (logged++ > 2) return;
  const pick = ["x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "x-vercel-ip-country", "true-client-ip", "cf-connecting-ip", "forwarded"];
  console.log("[ip-debug]", JSON.stringify(Object.fromEntries(pick.map((h) => [h, req.get(h) || null]))), "req.ip=" + req.ip);
}

module.exports = { clientIp, logIpHeaders };
