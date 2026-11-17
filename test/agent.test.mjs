// Checks the agent definitions against Tavus's documented API limits before
// they're sent, so a bad edit fails in CI instead of on a live setup run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, PERCEPTION, TOOLS, GUARDRAILS, OBJECTIVES } from "../agent/definitions.mjs";
import { buildGreeting, buildContext, flaggedFields } from "../lib/call-context.mjs";
import * as store from "../lib/store.mjs";

test("system prompt stays well under Tavus's 5,000-token guidance", () => {
  const approxTokens = SYSTEM_PROMPT.length / 4; // Tavus: 1 token ≈ 4 characters
  assert.ok(approxTokens < 2500, `prompt is ~${approxTokens} tokens`);
});

test("tools meet the /v2/tools rules", () => {
  for (const tool of TOOLS) {
    assert.match(tool.name, /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/, tool.name);
    assert.ok(tool.description.length + JSON.stringify(tool.parameters).length <= 10_000);
    for (const prop of Object.keys(tool.parameters.properties)) assert.ok(!prop.startsWith("tavus_"));
    if (tool.on_call === "static_filler") assert.ok(tool.static_filler, `${tool.name} needs static_filler`);
    // The default (fire_and_forget) would make the agent ignore our results.
    assert.notEqual(tool.on_resolve ?? "fire_and_forget", "fire_and_forget", tool.name);
    assert.deepEqual(tool.delivery, { app_message: true });
  }
});

test("tool names match the server's tool routes", () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), ["complete_request", "send_to_review", "update_field"]);
});

test("update_field's field enum matches the store's fields", () => {
  const update = TOOLS.find((t) => t.name === "update_field");
  assert.deepEqual(update.parameters.properties.field.enum.sort(), Object.keys(store.FIELDS).sort());
});

test("guardrails meet the /v2/guardrails rules", () => {
  for (const g of GUARDRAILS) {
    assert.match(g.guardrail_name, /^[A-Za-z0-9_]{1,100}$/);
    assert.ok(g.guardrail_prompt.length <= 1000);
  }
});

test("objective names have no spaces", () => {
  for (const o of OBJECTIVES) assert.match(o.objective_name, /^\S+$/);
});

test("perception uses Raven-2 and the post-call report is scoped to the invoice", () => {
  assert.equal(PERCEPTION.perception_model, "raven-2");
  for (const q of PERCEPTION.screen_awareness_queries) assert.ok(q.length <= 10_000);
  assert.match(PERCEPTION.perception_analysis_queries.join(" "), /Do not describe the participant/);
});

test("greeting names the customer, amount, vendor and number of issues", () => {
  store.reset();
  const greeting = buildGreeting(store.get("PR-1001"));
  assert.match(greeting, /^Hi Dana, this is Paige from Paytrellis/);
  assert.match(greeting, /\$4,200\.00 payment to Oakridge Fastener Supply/);
  assert.match(greeting, /2 details/);
});

test("greeting copes with a blank amount", () => {
  store.reset();
  assert.match(buildGreeting(store.get("PR-1004")), /your payment to Apex Elevator Services/);
});

test("context lists every field and which ones must be confirmed", () => {
  store.reset();
  const request = store.get("PR-1001");
  const context = buildContext(request);
  assert.deepEqual(flaggedFields(request), ["invoiceNumber", "amount"]);
  assert.match(context, /Invoice number \(invoiceNumber\): \(blank\) \[MISSING/);
  assert.match(context, /Amount \(amount\): \$4,200\.00 \[FLAGGED: Doesn't match/);
  assert.match(context, /must get confirmed: Invoice number \(invoiceNumber\), Amount \(amount\)/);
});
