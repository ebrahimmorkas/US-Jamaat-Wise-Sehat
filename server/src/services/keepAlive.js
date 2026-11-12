// Keep-alive for Render's free plan.
//
// Render stops a free server after 15 minutes without an incoming request, and waking it takes
// ~30-60 seconds (the first visitor waits, live updates drop). So the server calls its own
// PUBLIC address (/api/health) every few minutes: that request comes in through Render's edge
// like a visitor's, so the server never counts as idle.
//
// Runs only where a public address is known: RENDER_EXTERNAL_URL (set by Render itself) or
// KEEP_ALIVE_URL. Locally nothing happens. KEEP_ALIVE_ENABLED=false turns it off (e.g. on a paid plan).
// Never throws: a failed ping is logged and the next one is tried.
const config = require("../config");

let timer = null;

async function ping(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "us-sehhat-keep-alive" }, signal: AbortSignal.timeout(config.keepAlive.timeoutSeconds * 1000) });
    if (!res.ok) console.warn(`[keep-alive] ${url} answered ${res.status}`);
  } catch (err) {
    console.warn(`[keep-alive] ping failed: ${err.message}`);
  }
}

function startKeepAlive() {
  const { enabled, baseUrl, intervalMinutes } = config.keepAlive;
  if (!enabled || !baseUrl || !intervalMinutes || timer) return false;
  const url = `${baseUrl}/api/health`;
  timer = setInterval(() => ping(url), intervalMinutes * 60 * 1000);
  timer.unref(); // never the reason the process stays up (shutdown still works)
  console.log(`[keep-alive] pinging ${url} every ${intervalMinutes} min`);
  return true;
}

function stopKeepAlive() {
  clearInterval(timer);
  timer = null;
}

module.exports = { startKeepAlive, stopKeepAlive };
