// Route tests: start the app on a random port and call it over HTTP.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../lib/app.mjs";
import * as store from "../lib/store.mjs";

let server;
let base;

before(async () => {
  server = createApp().listen(0);
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

test("the vendor invoice pages are served", async () => {
  const res = await fetch(`${base}/vendor-portal/invoice-1042.html`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /INV-1042/);
});
