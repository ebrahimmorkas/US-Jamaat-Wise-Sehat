const mongoose = require("mongoose");
const config = require("./config");

// MongoDB stores users, sessions, audit logs and the data snapshot.
// If it is unavailable the dashboard data still comes from memory, sign-in waits,
// and the server keeps retrying in the background until it connects.
const RETRY_MS = 60 * 1000;
let retryTimer = null;
const onConnectedHooks = [];

const onConnected = (fn) => onConnectedHooks.push(fn);

async function tryConnect() {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 8000,
      ...(config.mongoDbName ? { dbName: config.mongoDbName } : {}),
    });
    console.log(`[db] Connected to MongoDB (database "${mongoose.connection.name}")`);
    for (const fn of onConnectedHooks) {
      try { await fn(); } catch (err) { console.warn("[db] Startup task failed:", err.message); }
    }
    return true;
  } catch (err) {
    console.warn(`[db] Could not connect to MongoDB (${err.message}). Retrying in ${RETRY_MS / 1000}s.`);
    return false;
  }
}

async function connectDb() {
  if (!config.mongoUri) {
    console.warn("[db] MONGODB_URI not set: running without MongoDB (sign-in will not work).");
    return false;
  }
  const ok = await tryConnect();
  if (!ok && !retryTimer) {
    retryTimer = setInterval(async () => {
      if (mongoose.connection.readyState === 1 || (await tryConnect())) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
    }, RETRY_MS);
    retryTimer.unref();
  }
  return ok;
}

const isDbReady = () => mongoose.connection.readyState === 1;

module.exports = { connectDb, isDbReady, onConnected, mongoose };
