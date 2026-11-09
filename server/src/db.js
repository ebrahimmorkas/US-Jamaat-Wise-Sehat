const mongoose = require("mongoose");
const config = require("./config");

// MongoDB is used as a durable cache. If it is unavailable the server still
// works from memory, so a database outage never takes the dashboard down.
async function connectDb() {
  if (!config.mongoUri) {
    console.warn("[db] MONGODB_URI not set: running without MongoDB (memory only).");
    return false;
  }
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log("[db] Connected to MongoDB");
    return true;
  } catch (err) {
    console.warn(`[db] Could not connect to MongoDB (${err.message}). Running from memory only.`);
    return false;
  }
}

const isDbReady = () => mongoose.connection.readyState === 1;

module.exports = { connectDb, isDbReady, mongoose };
