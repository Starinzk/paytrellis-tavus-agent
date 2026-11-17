// Tests for the ops queue's view logic.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { queueRows, counts, changes, issues, renderQueue, renderTranscript } from "../public/js/queue.mjs";
import * as store from "../lib/store.mjs";

beforeEach(() => store.reset());

test("requests needing review come first, closed ones last", () => {
  const rows = queueRows(store.list());
  assert.equal(rows[0].id, "PR-1008");
  assert.equal(rows[0].status.label, "Needs review");
  assert.equal(rows.at(-1).id, "PR-1007");
});

test("counts split the queue into review, open and closed", () => {
  assert.deepEqual(counts(store.list()), { open: 6, review: 1, done: 1 });
});

test("issues list what's wrong with each request", () => {
  const list = issues(store.get("PR-1001"));
  assert.deepEqual(
    list.map((i) => `${i.field}: ${i.kind}`),
    ["Invoice number: Missing", "Amount: Doesn't look right"],
  );
});

test("changes show the original value and the latest confirmed one", () => {
  store.updateField("PR-1001", "amount", "4002");
  store.updateField("PR-1001", "amount", "4020");
  store.updateField("PR-1001", "invoiceNumber", "INV-1042");
  assert.deepEqual(changes(store.get("PR-1001")), [
    { field: "Amount", from: "$4,200.00", to: "$4,020.00", flagged: false },
    { field: "Invoice number", from: "—", to: "INV-1042", flagged: false },
  ]);
});

test("a remit-to change is flagged as differing from the file", () => {
  store.updateField("PR-1002", "remitAccount", "6604 9917 2285");
  const [c] = changes(store.get("PR-1002"));
  assert.equal(c.flagged, true);
});

test("actions match status: call when open, approve/reject in review, nothing when closed", () => {
  const rows = Object.fromEntries(queueRows(store.list()).map((r) => [r.id, r]));
  assert.equal(rows["PR-1001"].canCall, true);
  assert.equal(rows["PR-1008"].canDecide, true);
  assert.equal(rows["PR-1007"].canCall || rows["PR-1007"].canDecide, false);
  const html = renderQueue(store.list());
  assert.match(html, /href="\/call\.html\?request=PR-1001"/);
  assert.match(html, /data-action="approve" data-id="PR-1008"/);
});

test("write-back result is shown once a request is decided", () => {
  store.decide("PR-1008", "reject");
  const row = queueRows(store.list()).find((r) => r.id === "PR-1008");
  assert.equal(row.writeBack.result, "failed");
  assert.match(renderQueue(store.list()), /Written back to portal: <strong>failed/);
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
  assert.match(html, /Screen report:<\/span> Invoice INV-1042/);
  assert.match(renderTranscript({ transcript: [], perception: null }), /not ready yet/);
});

test("a field the agent changed isn't listed twice", () => {
  store.updateField("PR-1002", "remitBank", "Pinecrest Federal Credit Union");
  const row = queueRows(store.list()).find((r) => r.id === "PR-1002");
  assert.ok(!row.issues.some((i) => i.field === "Remit-to bank"));
  assert.ok(row.changes.some((c) => c.field === "Remit-to bank"));
});
