import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import "./test-database.js";

const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
