const config = require("./config");
const app = require("./app");
const { connectDb, mongoose } = require("./db");

async function main() {
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

main().catch((err) => {
  console.error("[app] Failed to start:", err);
  process.exit(1);
});
