// Run one sync from the command line:  npm run sync --prefix server
const { connectDb, mongoose } = require("../db");
const sync = require("../services/sync");

(async () => {
  await connectDb();
  try {
    const snap = await sync.syncNow("cli");
    const jamaats = snap.jamiats.reduce((n, j) => n + j.jamaats.length, 0);
    console.log(`OK: ${snap.jamiats.length} Jamiats, ${jamaats} Jamaats, month "${snap.month}"`);
    if (snap.failed.length) console.log("Failed tabs:", snap.failed);
    process.exitCode = 0;
  } catch (err) {
    console.error("Sync failed:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close().catch(() => {});
  }
})();
