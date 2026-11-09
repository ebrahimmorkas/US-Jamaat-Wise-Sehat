// Vercel "Ignored Build Step": skip building a commit that is no longer the newest on main.
// GitHub sometimes delivers push events late/out of order; without this an old commit
// could be built last and replace the live site.  Exit 0 = skip build, exit 1 = build.
const { execSync } = require("child_process");

const branch = process.env.VERCEL_GIT_COMMIT_REF || "";
if (branch !== "main") process.exit(1); // only guard production

try {
  execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
  const head = execSync("git rev-parse HEAD").toString().trim();
  const tip = execSync("git rev-parse FETCH_HEAD").toString().trim();
  if (head && tip && head !== tip) {
    console.log(`Skipping outdated commit ${head.slice(0, 7)}; main is already at ${tip.slice(0, 7)}.`);
    process.exit(0);
  }
  console.log(`Building ${head.slice(0, 7)} (newest on main).`);
} catch (err) {
  console.log("Could not compare with main, building anyway:", err.message);
}
process.exit(1);
