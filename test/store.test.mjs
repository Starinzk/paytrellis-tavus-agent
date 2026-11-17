// The business rules: these decide whether money moves, so they're enforced and
// tested on the server rather than trusted to the agent's prompt.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as store from "../lib/store.mjs";

beforeEach(() => store.reset());

test("seed data loads all eight requests", () => {
  assert.equal(store.list().length, 8);
  assert.equal(store.get("PR-1001").customer.name, "Northwind Fabrication");
});

test("a request can't complete while a field is missing or suspect", () => {
  const result = store.completeRequest("PR-1001");
  assert.equal(result.ok, false);
  assert.deepEqual(result.remaining, ["invoiceNumber", "amount"]);
  assert.equal(store.get("PR-1001").status, "needs_info");
});

test("confirming every flagged field lets the request complete and write back success", () => {
  store.updateField("PR-1001", "invoiceNumber", "INV-1042");
  store.updateField("PR-1001", "amount", "$4,020.00");
  const result = store.completeRequest("PR-1001");
  assert.equal(result.ok, true);
  const request = store.get("PR-1001");
  assert.equal(request.status, "completed");
  assert.equal(request.writeBack.result, "success");
  assert.equal(request.fields.amount.value, 4020);
  assert.equal(request.fields.amount.previous, 4200);
});

test("remit-to details that differ from the file are marked changed and block completion", () => {
  store.updateField("PR-1002", "vendorAccount", "V-90412");
  const update = store.updateField("PR-1002", "remitBank", "Harborview Credit Union");
  assert.equal(update.status, "changed");
  const result = store.completeRequest("PR-1002");
  assert.equal(result.ok, false);
  assert.equal(result.mustReview, true);
  assert.equal(store.get("PR-1002").status, "needs_info");
});

test("remit-to details matching the file are confirmed, ignoring spacing", () => {
  const update = store.updateField("PR-1001", "remitAccount", "440211867316");
  assert.equal(update.status, "confirmed");
});

test("blank and invalid values are refused", () => {
  assert.throws(() => store.updateField("PR-1001", "invoiceNumber", "  "), store.RuleError);
  assert.throws(() => store.updateField("PR-1001", "amount", "four thousand"), store.RuleError);
  assert.throws(() => store.updateField("PR-1001", "bankPassword", "x"), store.RuleError);
});

test("send to review, then an ops decision writes back success or failed", () => {
  store.sendToReview("PR-1002", "Bank details changed");
  assert.equal(store.get("PR-1002").status, "in_review");
  store.decide("PR-1002", "reject", "Couldn't verify with vendor");
  assert.equal(store.get("PR-1002").status, "rejected");
  assert.equal(store.get("PR-1002").writeBack.result, "failed");

  const approved = store.decide("PR-1008", "approve");
  assert.equal(approved.writeBack.result, "success");
});

test("closed requests can't be changed by the agent", () => {
  assert.throws(() => store.updateField("PR-1007", "amount", "1"), store.RuleError);
  assert.throws(() => store.completeRequest("PR-1008"), store.RuleError);
  assert.throws(() => store.decide("PR-1001", "approve"), store.RuleError);
});

test("every change is recorded in the request history", () => {
  store.updateField("PR-1001", "invoiceNumber", "INV-1042");
  store.updateField("PR-1001", "amount", "4020");
  store.completeRequest("PR-1001");
  const types = store.get("PR-1001").history.map((h) => h.type);
  assert.deepEqual(types, ["field_updated", "field_updated", "completed"]);
});
