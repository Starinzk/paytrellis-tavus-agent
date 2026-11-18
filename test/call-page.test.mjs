// Tests for the call page's logic: the tool-call relay and the checklist.
// Both are plain modules, so they run in Node without a browser or a live call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, isToolCall } from "../public/js/tool-relay.mjs";
import { ledgerRows, progress, outcome, renderLedger } from "../public/js/checklist.mjs";
import * as store from "../lib/store.mjs";

const toolCall = (name, args, extra = {}) => ({
  message_type: "conversation",
  event_type: "conversation.tool_call",
  conversation_id: "c1",
  properties: { name, arguments: JSON.stringify(args), tool_call_id: "tc-1", ...extra },
});

test("ignores app messages that aren't tool calls", async () => {
  let sent = false;
  const result = await handleToolCall(
    { message_type: "conversation", event_type: "conversation.utterance" },
    { runTool: async () => ({}), send: () => (sent = true) },
  );
  assert.equal(result, null);
  assert.equal(sent, false);
  assert.equal(isToolCall(null), false);
});

test("runs a tool and sends a tool_result with the matching tool_call_id", async () => {
  const seen = [];
  const sent = [];
  await handleToolCall(toolCall("update_field", { field: "invoiceNumber", value: "INV-1042" }), {
    runTool: async (name, args) => {
      seen.push({ name, args });
      return { status: 200, body: { ok: true, message: "Invoice number saved as INV-1042." } };
    },
    send: (p) => sent.push(p),
  });
  assert.deepEqual(seen, [{ name: "update_field", args: { field: "invoiceNumber", value: "INV-1042" } }]);
  assert.deepEqual(sent[0], {
    message_type: "conversation",
    event_type: "conversation.tool_result",
    conversation_id: "c1",
    properties: { tool_call_id: "tc-1", output: "Invoice number saved as INV-1042.", status: "success" },
  });
});

test("a rule refusal reaches the agent as a readable 'Not done' message", async () => {
  const sent = [];
  await handleToolCall(toolCall("complete_request", {}), {
    runTool: async () => ({ status: 200, body: { ok: false, reason: "Still unconfirmed: Amount." } }),
    send: (p) => sent.push(p),
  });
  assert.equal(sent[0].properties.output, "Not done: Still unconfirmed: Amount.");
  assert.equal(sent[0].properties.status, "success");
});

test("server errors and bad input come back as status error, never silence", async () => {
  const sent = [];
  const deps = { send: (p) => sent.push(p) };
  await handleToolCall(toolCall("update_field", { field: "amount", value: "" }), {
    ...deps,
    runTool: async () => ({ status: 422, body: { error: "Amount can't be blank" } }),
  });
  await handleToolCall(toolCall("wire_money", {}), { ...deps, runTool: async () => assert.fail("must not run") });
  await handleToolCall(toolCall("update_field", {}, { arguments: "{not json" }), {
    ...deps,
    runTool: async () => assert.fail("must not run"),
  });
  assert.deepEqual(
    sent.map((s) => s.properties.status),
    ["error", "error", "error"],
  );
  assert.match(sent[0].properties.output, /can't be blank/);
  assert.match(sent[1].properties.output, /Unknown tool wire_money/);
});

test("ledger compares the request with what was confirmed, field by field", () => {
  store.reset();
  let rows = ledgerRows(store.get("PR-1001"));
  const invoice = rows.find((r) => r.key === "invoiceNumber");
  assert.equal(invoice.state, "needs");
  assert.equal(invoice.tag.label, "Missing");
  assert.equal(invoice.requested, null);
  assert.deepEqual(progress(store.get("PR-1001")), { done: 0, total: 2 });

  store.updateField("PR-1001", "amount", "4020");
  rows = ledgerRows(store.get("PR-1001"));
  const amount = rows.find((r) => r.key === "amount");
  assert.equal(amount.state, "locked");
  assert.equal(amount.requested, "$4,200.00");
  assert.equal(amount.confirmed, "$4,020.00");
  assert.equal(amount.corrected, true);
  assert.deepEqual(progress(store.get("PR-1001")), { done: 1, total: 2 });
});

test("unflagged fields need no action and don't count toward progress", () => {
  store.reset();
  const vendor = ledgerRows(store.get("PR-1001")).find((r) => r.key === "vendorAccount");
  assert.equal(vendor.state, "ok");
  assert.equal(vendor.tag, null);
  assert.match(renderLedger(store.get("PR-1001")), /No change needed/);
});

test("a changed remit-to shows as 'team will verify', and the outcome explains what happens next", () => {
  store.reset();
  store.updateField("PR-1002", "remitBank", "Pinecrest Federal Credit Union");
  const row = ledgerRows(store.get("PR-1002")).find((r) => r.key === "remitBank");
  assert.equal(row.state, "flagged");
  assert.equal(row.tag.label, "Team will verify");
  assert.equal(outcome(store.get("PR-1002")).tone, "hold");
  store.sendToReview("PR-1002", "Bank details changed");
  assert.match(outcome(store.get("PR-1002")).title, /team member will verify/);
});

test("the field that just changed is marked so it can highlight", () => {
  store.reset();
  store.updateField("PR-1001", "invoiceNumber", "INV-1042");
  assert.match(renderLedger(store.get("PR-1001"), new Set(["invoiceNumber"])), /class="locked just-locked" data-field="invoiceNumber"/);
});

test("ledger HTML escapes values", () => {
  store.reset();
  store.updateField("PR-1001", "invoiceNumber", "<img src=x onerror=alert(1)>");
  const html = renderLedger(store.get("PR-1001"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});
