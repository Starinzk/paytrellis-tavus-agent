// Guards against the most expensive mistake in this repo: committing the API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url);

test(".env is ignored by git", () => {
  // `git check-ignore` exits non-zero (and throws) when the path is NOT ignored.
  const out = execFileSync("git", ["check-ignore", ".env"], { cwd: root, encoding: "utf8" });
  assert.equal(out.trim(), ".env");
});

test(".env.example lists every required setting with a placeholder, not a real key", async () => {
  const example = await readFile(new URL(".env.example", root), "utf8");
  assert.match(example, /^TAVUS_API_KEY=paste-your-key-here$/m);
  assert.match(example, /^TAVUS_FACE_ID=\S+$/m);
});

test("no tracked file looks like it contains a filled-in .env", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");
  assert.ok(!tracked.includes(".env"), ".env must never be committed");
});
