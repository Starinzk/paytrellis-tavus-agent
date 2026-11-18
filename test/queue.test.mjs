// Tests for the ops queue's view logic.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  queueRows,
  counts,
  changes,
  issues,
  bankChange,
  problemSummary,
  daysOnHold,
  renderQueue,
  renderTabs,
  renderTranscript,
} from "../public/js/queue.mjs";
import * as store from "../lib/store.mjs";

const NOW = Date.parse("2026-11-17T18:00:00Z");
beforeEach(() => store.reset());

test("requests are grouped into review, info and closed tabs", () => {
  assert.deepEqual(counts(store.list()), { review: 1, info: 6, closed: 1 });
  assert.match(renderTabs(store.list(), "review"), /aria-selected="true"[^>]*>Needs review<span class="n">1</);
});

test("oldest requests come first, and three days or more is marked as old", () => {
  const rows = queueRows(store.list(), NOW).filter((r) => r.tab === "info");
  assert.equal(rows[0].id, "PR-1001"); // submitted 12 Nov
  assert.equal(daysOnHold(store.get("PR-1001"), NOW), 5);
  assert.equal(rows[0].age, "5 days on hold");
  assert.equal(rows[0].old, true);
  assert.equal(rows.at(-1).old, false);
});

test("problem summary is one readable line", () => {
  assert.equal(problemSummary(store.get("PR-1001")), "Invoice number missing, amount doesn't look right");
  assert.equal(problemSummary(store.get("PR-1008")), "New bank details for this vendor");
});

test("issues list what's wrong with each request", () => {
  assert.deepEqual(
    issues(store.get("PR-1001")).map((i) => `${i.field}: ${i.kind}`),
    ["Invoice number: missing", "Amount: doesn't look right"],
  );
});

test("changes show the submitted value and the latest confirmed one", () => {
  store.updateField("PR-1001", "amount", "4002");
  store.updateField("PR-1001", "amount", "4020");
  store.updateField("PR-1001", "invoiceNumber", "INV-1042");
  assert.deepEqual(changes(store.get("PR-1001")), [
    { key: "amount", field: "Amount", from: "$4,200.00", to: "$4,020.00", flagged: false },
    { key: "invoiceNumber", field: "Invoice number", from: "blank", to: "INV-1042", flagged: false },
  ]);
});

test("confirming a value that didn't change isn't listed as a change", () => {
  store.updateField("PR-1001", "vendorAccount", "V-58213");
  assert.deepEqual(changes(store.get("PR-1001")), []);
});

test("a field the agent changed isn't listed twice", () => {
  store.updateField("PR-1002", "remitBank", "Pinecrest Federal Credit Union");
  const row = queueRows(store.list()).find((r) => r.id === "PR-1002");
  assert.ok(!row.issues.some((i) => i.key === "remitBank"));
  assert.ok(row.changes.some((c) => c.key === "remitBank" && c.flagged));
});

test("bank change review shows details on file next to the new ones", () => {
  assert.deepEqual(bankChange(store.get("PR-1008")), [
    { field: "Remit-to bank", onFile: "First Valley Bank", proposed: "Harborview Credit Union" },
    { field: "Remit-to account", onFile: "5512 0098 4471", proposed: "8820 1147 3306" },
  ]);
});

test("Approve stays disabled until the bank change is marked verified", () => {
  const expanded = new Set(["PR-1008"]);
  let html = renderQueue(store.list(), { tab: "review", expanded });
  assert.match(html, /data-action="approve" data-id="PR-1008"[^>]*disabled/);
  assert.match(html, /called the vendor on a phone number we already had on file/);
  html = renderQueue(store.list(), { tab: "review", expanded, verified: new Set(["PR-1008"]) });
  assert.doesNotMatch(html, /data-action="approve" data-id="PR-1008"[^>]*disabled/);
});

test("a review without a bank change can be approved straight away", () => {
  store.sendToReview("PR-1001", "Customer says the amount includes a late fee");
  const html = renderQueue(store.list(), { tab: "review", expanded: new Set(["PR-1001"]) });
  assert.doesNotMatch(html, /data-action="approve" data-id="PR-1001"[^>]*disabled/);
  assert.doesNotMatch(html, /verify-PR-1001/);
});

test("each tab only shows its own requests, with a helpful empty state", () => {
  assert.doesNotMatch(renderQueue(store.list(), { tab: "review" }), /PR-1001/);
  store.decide("PR-1008", "reject");
  assert.match(renderQueue(store.list(), { tab: "review" }), /Nothing needs review/);
});

test("closed requests show the portal write-back result", () => {
  store.decide("PR-1008", "reject");
  const html = renderQueue(store.list(), { tab: "closed", expanded: new Set(["PR-1008"]) });
  assert.match(html, /Written back to the portal as <strong>failed/);
});

test("open requests link to the call page", () => {
  const html = renderQueue(store.list(), { tab: "info", expanded: new Set(["PR-1001"]) });
  assert.match(html, /href="\/call\.html\?request=PR-1001"/);
});

test("transcript renders speakers and escapes content", () => {
  const html = renderTranscript({
    transcript: [
      { role: "assistant", content: "Hi Dana" },
      { role: "user", content: "<b>hi</b>" },
    ],
    perception: "Invoice INV-1042",
  });
  assert.match(html, /Paige:<\/span> Hi Dana/);
  assert.match(html, /Customer:<\/span> &lt;b&gt;hi/);
  assert.match(html, /What Paige saw on screen/);
  assert.match(renderTranscript({ transcript: [], perception: null }), /isn't ready yet/);
});

test("a request with every detail confirmed but not submitted says so", () => {
  store.updateField("PR-1005", "invoiceNumber", "INV-8801");
  assert.equal(problemSummary(store.get("PR-1005")), "Details confirmed, not yet submitted");
});
