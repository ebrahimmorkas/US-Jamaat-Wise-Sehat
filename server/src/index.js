const config = require("./config");
const app = require("./app");
const { connectDb, mongoose } = require("./db");
const sync = require("./services/sync");

async function main() {
  await connectDb();
  await sync.loadFromDb(); // serve the last saved data immediately

  const server = app.listen(config.port, () => {
    console.log(`[http] API listening on http://localhost:${config.port} (sheet access: ${config.sheetAccess})`);
  });

  sync.syncNow("startup").catch(() => {}); // fresh pull in the background
  sync.startSchedule();

  const shutdown = (signal) => {
    console.log(`[app] ${signal} received, shutting down`);
    server.close(() => mongoose.connection.close(false).finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[app] Failed to start:", err);
  process.exit(1);
});
