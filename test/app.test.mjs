// Route tests: start the app on a random port and call it over HTTP.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../lib/app.mjs";
import * as store from "../lib/store.mjs";

let server;
let base;

// Stand-in for the Tavus API: records requests and returns canned responses.
const tavusCalls = [];
async function fakeTavus(method, path, body) {
  tavusCalls.push({ method, path, body });
  if (method === "POST" && path === "/conversations") {
    return { conversation_id: "c-test", conversation_url: "https://tavus.daily.co/c-test" };
  }
  if (method === "GET" && path.startsWith("/conversations/c-test")) {
    return {
      status: "ended",
      events: [
        {
          event_type: "application.transcription_ready",
          properties: {
            transcript: [
              { role: "system", content: "hidden" },
              { role: "assistant", content: "Hi Dana" },
              { role: "user", content: "Hi" },
            ],
          },
        },
        { event_type: "application.perception_analysis", properties: { analysis: "Invoice INV-1042" } },
      ],
    };
  }
  return {};
}

before(async () => {
  server = createApp({ tavus: fakeTavus, getAgent: async () => ({ pal_id: "p-test" }) }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => store.reset());

const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/requests lists the queue", async () => {
  const res = await fetch(`${base}/api/requests`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 8);
});

test("GET /api/requests/:id returns 404 for an unknown request", async () => {
  assert.equal((await fetch(`${base}/api/requests/PR-9999`)).status, 404);
});

test("tool routes run the rules and return the result the agent will hear", async () => {
  let res = await post("/api/requests/PR-1001/tools/update_field", { field: "invoiceNumber", value: "INV-1042" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "confirmed");

  res = await post("/api/requests/PR-1001/tools/complete_request", {});
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.remaining, ["amount"]);
});

test("rule violations come back as 422 with a readable message", async () => {
  const res = await post("/api/requests/PR-1001/tools/update_field", { field: "amount", value: "" });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /can't be blank/);
});

test("unknown tools are rejected", async () => {
  assert.equal((await post("/api/requests/PR-1001/tools/wire_money", {})).status, 404);
});

test("ops decision route approves a request in review", async () => {
  const res = await post("/api/requests/PR-1008/decision", { decision: "approve" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).writeBack.result, "success");
});

test("reset restores the starting data", async () => {
  await post("/api/requests/PR-1008/decision", { decision: "approve" });
  await post("/api/reset", {});
  const res = await fetch(`${base}/api/requests/PR-1008`);
  assert.equal((await res.json()).status, "in_review");
});

test("starting a call creates a Tavus conversation with the request's greeting and context", async () => {
  tavusCalls.length = 0;
  const res = await post("/api/requests/PR-1001/call", {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).conversation_url, "https://tavus.daily.co/c-test");

  const { body } = tavusCalls.find((c) => c.path === "/conversations");
  assert.equal(body.pal_id, "p-test");
  assert.match(body.custom_greeting, /^Hi Dana/);
  assert.match(body.conversational_context, /PR-1001/);
  assert.equal(body.properties.max_call_duration, 600);

  const request = store.get("PR-1001");
  assert.equal(request.status, "in_call");
  assert.equal(request.conversationId, "c-test");
});

test("a closed request can't start a call", async () => {
  const res = await post("/api/requests/PR-1007/call", {});
  assert.equal(res.status, 422);
});

test("leaving a call without resolving it puts the request back in the queue", async () => {
  await post("/api/requests/PR-1001/call", {});
  tavusCalls.length = 0;
  const res = await post("/api/requests/PR-1001/end-call", {});
  assert.equal((await res.json()).status, "needs_info");
  assert.ok(tavusCalls.some((c) => c.path === "/conversations/c-test/end"));
});

test("transcript route returns the conversation without system messages", async () => {
  await post("/api/requests/PR-1001/call", {});
  const body = await (await fetch(`${base}/api/requests/PR-1001/transcript`)).json();
  assert.deepEqual(
    body.transcript.map((t) => t.role),
    ["assistant", "user"],
  );
  assert.equal(body.perception, "Invoice INV-1042");
});

test("the call page and the Daily SDK it needs are served", async () => {
  const page = await fetch(`${base}/call.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/vendor\/daily\.js/);
  const sdk = await fetch(`${base}/vendor/daily.js`);
  assert.equal(sdk.status, 200);
  assert.match((await sdk.text()).slice(0, 400), /Daily/);
});

test("the vendor invoice pages are served", async () => {
  const res = await fetch(`${base}/vendor-portal/invoice-1042.html`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /INV-1042/);
});
