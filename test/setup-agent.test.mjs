// Runs `npm run setup-agent` against a local fake of the Tavus API to check the
// order of calls and that a second run reuses what exists instead of duplicating it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const script = new URL("../agent/setup-agent.mjs", import.meta.url).pathname;

let server;
let base;
let calls = [];
let dir;
let n = 0;

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method, path: req.url, body });
      const reply = (obj) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
      n++;
      if (req.url === "/guardrails") return reply({ uuid: `g${n}` });
      if (req.url === "/objectives") return reply({ objectives_id: `o${n}` });
      if (req.method === "POST" && req.url === "/tools") return reply({ tool_id: `t${n}` });
      if (req.method === "POST" && req.url === "/pals") return reply({ pal_id: `p${n}` });
      reply({});
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  dir = await mkdtemp(join(tmpdir(), "agent-"));
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const env = () => ({
  ...process.env,
  TAVUS_API_BASE: base,
  TAVUS_API_KEY: "test-key",
  TAVUS_FACE_ID: "face-test",
  AGENT_STATE_FILE: join(dir, "agent.json"),
});

test("first run creates guardrails, objective, tools and PAL, then attaches the tools", async () => {
  calls = [];
  await run(process.execPath, [script], { env: env() });
  const steps = calls.map((c) => `${c.method} ${c.path.replace(/\/[gotp]\d+/, "/:id")}`);
  assert.deepEqual(steps.slice(0, 4), ["POST /guardrails", "POST /guardrails", "POST /guardrails", "POST /objectives"]);
  assert.equal(steps.filter((s) => s === "POST /tools").length, 3);
  assert.equal(steps.at(-2), "POST /pals");
  assert.equal(steps.at(-1), "POST /pals/:id/tools");

  const pal = calls.find((c) => c.method === "POST" && c.path === "/pals").body;
  assert.equal(pal.default_face_id, "face-test");
  assert.equal(pal.guardrail_ids.length, 3);
  assert.equal(pal.layers.perception.perception_model, "raven-2");
  assert.equal(calls.at(-1).body.tool_ids.length, 3);

  const state = JSON.parse(await readFile(join(dir, "agent.json"), "utf8"));
  assert.ok(state.pal_id && state.objectives_id);
});

test("second run reuses guardrails and objective, updates tools, and replaces the PAL", async () => {
  const before = JSON.parse(await readFile(join(dir, "agent.json"), "utf8"));
  calls = [];
  await run(process.execPath, [script], { env: env() });
  const steps = calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(!steps.includes("POST /guardrails"));
  assert.ok(!steps.includes("POST /objectives"));
  assert.ok(!steps.includes("POST /tools"));
  assert.equal(steps.filter((s) => s.startsWith("PATCH /tools/")).length, 3);
  assert.ok(steps.includes(`DELETE /pals/${before.pal_id}`));

  const after = JSON.parse(await readFile(join(dir, "agent.json"), "utf8"));
  assert.notEqual(after.pal_id, before.pal_id);
  assert.deepEqual(after.tools, before.tools);
});
