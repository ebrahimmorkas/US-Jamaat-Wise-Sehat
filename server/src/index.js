const config = require("./config");
const app = require("./app");
const { connectDb, onConnected, mongoose } = require("./db");
const { migrate } = require("./services/migrate");
const { logError } = require("./services/audit");

async function main() {
  onConnected(migrate); // role changes, indexes, default dropdown values
  await connectDb(); // keeps retrying in the background if MongoDB is not reachable yet

  const server = app.listen(config.port, () => {
    console.log(`[http] API listening on http://localhost:${config.port}`);
  });

  const shutdown = (signal) => {
    console.log(`[app] ${signal} received, shutting down`);
    server.close(() => mongoose.connection.close(false).finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Errors outside a request are logged too (the server keeps running after an unhandled rejection).
process.on("unhandledRejection", (reason) => {
  console.error("[app] Unhandled rejection:", reason);
  logError({ message: reason && reason.message ? reason.message : String(reason), stack: reason && reason.stack, details: { kind: "unhandledRejection" } });
});
process.on("uncaughtException", (err) => {
  console.error("[app] Uncaught exception:", err);
  logError({ message: err.message, stack: err.stack, details: { kind: "uncaughtException" } });
  setTimeout(() => process.exit(1), 1000).unref(); // let the log be written, then restart cleanly
});

main().catch((err) => {
  console.error("[app] Failed to start:", err);
  process.exit(1);
});
