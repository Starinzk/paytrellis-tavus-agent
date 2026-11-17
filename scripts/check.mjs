// Syntax-checks every JavaScript file in the repo without running it.
// Used locally (`npm run check`) and in CI.
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git"]);

async function* jsFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(path);
    else if (/\.(mjs|js)$/.test(entry.name)) yield path;
  }
}

let failed = 0;
let checked = 0;
for await (const file of jsFiles(ROOT)) {
  checked++;
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed++;
    console.error(`✗ ${relative(ROOT, file)}\n${result.stderr}`);
  }
}

console.log(`Syntax check: ${checked - failed}/${checked} files OK`);
process.exit(failed ? 1 : 0);
