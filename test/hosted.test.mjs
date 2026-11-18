// Hosted-demo settings: access code, hourly call limit, call length, and config
// coming from the platform's environment instead of local files.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../lib/app.mjs";
import { readConfig, codeMatches, callLimiter } from "../lib/config.mjs";
import { loadDotEnv } from "../lib/env.mjs";
import * as store from "../lib/store.mjs";

const servers = [];
after(() => servers.forEach((s) => s.close()));

async function start(options) {
  const server = createApp(options).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

const tavusCalls = [];
const fakeTavus = async (method, path, body) => {
  tavusCalls.push({ method, path, body });
  return { conversation_id: "c-host", conversation_url: "https://tavus.daily.co/c-host" };
};
const agent = async () => ({ pal_id: "p-host" });
const startCall = (base, id, body = {}) =>
  fetch(`${base}/api/requests/${id}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("local defaults: no access code, no hourly limit, 10-minute calls", () => {
  assert.deepEqual(readConfig({}), { accessCode: null, maxCallsPerHour: Infinity, maxCallSeconds: 600 });
});

test("hosted settings are read from the environment", () => {
  const config = readConfig({ DEMO_ACCESS_CODE: " trellis ", MAX_CALLS_PER_HOUR: "10", MAX_CALL_SECONDS: "300" });
  assert.deepEqual(config, { accessCode: "trellis", maxCallsPerHour: 10, maxCallSeconds: 300 });
  assert.equal(readConfig({ MAX_CALL_SECONDS: "abc" }).maxCallSeconds, 600);
});

test("access code comparison", () => {
  assert.equal(codeMatches(null, undefined), true);
  assert.equal(codeMatches("trellis", "trellis"), true);
  assert.equal(codeMatches("trellis", "Trellis"), false);
  assert.equal(codeMatches("trellis", ""), false);
});

test("the hourly limit is a rolling window", () => {
  let now = 0;
  const limiter = callLimiter(2, () => now);
  assert.equal(limiter.tryStart(), true);
  assert.equal(limiter.tryStart(), true);
  assert.equal(limiter.tryStart(), false);
  now = 3_600_001;
  assert.equal(limiter.tryStart(), true);
});

test("with an access code set, calls need the right code and pages say so", async () => {
  store.reset();
  const base = await start({ tavus: fakeTavus, getAgent: agent, config: { ...readConfig({}), accessCode: "trellis" } });
  assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { accessCodeRequired: true });

  let res = await startCall(base, "PR-1001");
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /access code/);
  assert.equal(store.get("PR-1001").status, "needs_info");

  res = await startCall(base, "PR-1001", { accessCode: "trellis" });
  assert.equal(res.status, 200);
});

test("the hourly limit refuses extra calls with a readable message", async () => {
  store.reset();
  const base = await start({ tavus: fakeTavus, getAgent: agent, config: { ...readConfig({}), maxCallsPerHour: 1 } });
  assert.equal((await startCall(base, "PR-1001")).status, 200);
  const res = await startCall(base, "PR-1002");
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /hourly call limit/);
  assert.equal(store.get("PR-1002").status, "needs_info");
});

test("closed payments are refused before using up the hourly allowance", async () => {
  store.reset();
  const base = await start({ tavus: fakeTavus, getAgent: agent, config: { ...readConfig({}), maxCallsPerHour: 1 } });
  assert.equal((await startCall(base, "PR-1007")).status, 422);
  assert.equal((await startCall(base, "PR-1001")).status, 200);
});

test("the call length cap is passed to Tavus", async () => {
  store.reset();
  tavusCalls.length = 0;
  const base = await start({ tavus: fakeTavus, getAgent: agent, config: { ...readConfig({}), maxCallSeconds: 300 } });
  await startCall(base, "PR-1001");
  assert.equal(tavusCalls.find((c) => c.path === "/conversations").body.properties.max_call_duration, 300);
});

test("on a host, the agent ID comes from TAVUS_PAL_ID", async () => {
  store.reset();
  tavusCalls.length = 0;
  process.env.TAVUS_PAL_ID = "p-from-env";
  try {
    const base = await start({ tavus: fakeTavus });
    assert.equal((await startCall(base, "PR-1001")).status, 200);
    assert.equal(tavusCalls.find((c) => c.path === "/conversations").body.pal_id, "p-from-env");
  } finally {
    delete process.env.TAVUS_PAL_ID;
  }
});

test(".env is loaded when present and never overrides real settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "env-"));
  const file = join(dir, ".env");
  await writeFile(file, '# comment\nPT_TEST_A=from-file\nPT_TEST_B="quoted"\nPT_TEST_C=from-file\n');
  process.env.PT_TEST_C = "from-platform";
  assert.equal(loadDotEnv(pathToFileURL(file)), true);
  assert.equal(process.env.PT_TEST_A, "from-file");
  assert.equal(process.env.PT_TEST_B, "quoted");
  assert.equal(process.env.PT_TEST_C, "from-platform");
  assert.equal(loadDotEnv(pathToFileURL(join(dir, "missing"))), false);
  for (const k of ["PT_TEST_A", "PT_TEST_B", "PT_TEST_C"]) delete process.env[k];
  await rm(dir, { recursive: true, force: true });
});
