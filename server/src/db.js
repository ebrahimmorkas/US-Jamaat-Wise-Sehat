const mongoose = require("mongoose");
const config = require("./config");

// MongoDB is used as a durable cache. If it is unavailable the server still
// works from memory, and keeps retrying in the background until it connects.
const RETRY_MS = 60 * 1000;
let retryTimer = null;

async function tryConnect() {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 8000,
      ...(config.mongoDbName ? { dbName: config.mongoDbName } : {}),
    });
    console.log(`[db] Connected to MongoDB (database "${mongoose.connection.name}")`);
    return true;
  } catch (err) {
    console.warn(`[db] Could not connect to MongoDB (${err.message}). Running from memory; retrying in ${RETRY_MS / 1000}s.`);
    return false;
  }
}

async function connectDb() {
  if (!config.mongoUri) {
    console.warn("[db] MONGODB_URI not set: running without MongoDB (memory only).");
    return false;
  }
  const ok = await tryConnect();
  if (!ok && !retryTimer) {
    retryTimer = setInterval(async () => {
      if (mongoose.connection.readyState === 1) { clearInterval(retryTimer); retryTimer = null; return; }
      if (await tryConnect()) { clearInterval(retryTimer); retryTimer = null; }
    }, RETRY_MS);
    retryTimer.unref();
  }
  return ok;
}

const isDbReady = () => mongoose.connection.readyState === 1;

module.exports = { connectDb, isDbReady, mongoose };
