// Stand-in for Paytrellis's payment-request API.
// In production these functions become calls to the real system; nothing else in
// the app needs to change. Data lives in memory and resets when the server restarts.
import { readFileSync } from "node:fs";

const SEED = JSON.parse(readFileSync(new URL("../data/requests.json", import.meta.url), "utf8"));

export const FIELDS = {
  invoiceNumber: "Invoice number",
  amount: "Amount",
  vendorAccount: "Vendor account number",
  remitBank: "Remit-to bank",
  remitAccount: "Remit-to account number",
};

// Field statuses:
//   ok         on the request and not flagged
//   missing    blank on the request
//   suspect    flagged as possibly wrong
//   confirmed  value confirmed aloud by the customer on a call
//   changed    remit-to detail differs from the vendor's details on file (needs a person)
const UNRESOLVED = new Set(["missing", "suspect"]);
const ACTIVE = new Set(["needs_info", "in_call"]);

let requests = new Map();

export function reset() {
  requests = new Map(structuredClone(SEED).map((r) => [r.id, { ...r, history: [] }]));
}
reset();

export function list() {
  return [...requests.values()];
}

export function get(id) {
  return requests.get(id) ?? null;
}

function mustGet(id) {
  const request = get(id);
  if (!request) throw new RuleError(`No payment request with id ${id}`);
  return request;
}

export class RuleError extends Error {}

function log(request, event) {
  request.history.push({ at: new Date().toISOString(), ...event });
}

export function unresolvedFields(request) {
  return Object.entries(request.fields)
    .filter(([, f]) => UNRESOLVED.has(f.status))
    .map(([key]) => key);
}

function normalize(field, value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new RuleError(`${FIELDS[field]} can't be blank`);
  }
  if (field === "amount") {
    const n = Number(String(value).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0) throw new RuleError(`"${value}" isn't a valid amount`);
    return Math.round(n * 100) / 100;
  }
  return String(value).trim();
}

const digits = (s) => String(s ?? "").replace(/\D/g, "");

export function markInCall(id) {
  const request = mustGet(id);
  if (!ACTIVE.has(request.status)) throw new RuleError(`${id} is ${request.status}, not open for a call`);
  request.status = "in_call";
  log(request, { type: "call_started" });
  return request;
}

// Tool: the customer confirmed a value aloud.
export function updateField(id, field, rawValue, source = "customer") {
  const request = mustGet(id);
  if (!ACTIVE.has(request.status)) throw new RuleError(`${id} is ${request.status} and can't be changed`);
  if (!(field in FIELDS)) throw new RuleError(`Unknown field "${field}"`);

  const value = normalize(field, rawValue);
  const current = request.fields[field];
  const from = current.value;

  let status = "confirmed";
  let note;
  if (field === "remitBank" || field === "remitAccount") {
    const onFile = field === "remitBank" ? request.vendor.remitOnFile.bank : request.vendor.remitOnFile.account;
    const same =
      field === "remitAccount"
        ? digits(value) === digits(onFile)
        : value.toLowerCase() === onFile.toLowerCase();
    if (!same) {
      status = "changed";
      note = `On file: ${onFile}`;
    }
  }

  request.fields[field] = { value, status, ...(note ? { note } : {}), previous: from };
  log(request, { type: "field_updated", field, from, to: value, status, source });

  return {
    ok: true,
    field,
    value,
    status,
    remaining: unresolvedFields(request),
    message:
      status === "changed"
        ? `${FIELDS[field]} differs from the details on file. This request must go to a Paytrellis team member for review.`
        : `${FIELDS[field]} saved as ${value}.`,
  };
}

// Tool: try to complete the request. The server enforces the rules, not the prompt.
export function completeRequest(id) {
  const request = mustGet(id);
  if (!ACTIVE.has(request.status)) throw new RuleError(`${id} is ${request.status} and can't be completed`);

  const remaining = unresolvedFields(request);
  if (remaining.length) {
    return {
      ok: false,
      reason: `Still unconfirmed: ${remaining.map((f) => FIELDS[f]).join(", ")}.`,
      remaining,
    };
  }
  const changed = Object.entries(request.fields)
    .filter(([, f]) => f.status === "changed")
    .map(([key]) => key);
  if (changed.length) {
    return {
      ok: false,
      reason: "Remit-to details changed. Send this request to review instead.",
      mustReview: true,
    };
  }

  request.status = "completed";
  request.writeBack = { result: "success", at: new Date().toISOString() };
  log(request, { type: "completed" });
  return { ok: true, status: "completed", message: "Payment request completed and sent for payment." };
}

// Tool: hand the request to an ops staffer.
export function sendToReview(id, reason) {
  const request = mustGet(id);
  if (!ACTIVE.has(request.status)) throw new RuleError(`${id} is ${request.status} and can't be sent to review`);
  const text = String(reason ?? "").trim() || "Agent asked for a review";
  request.status = "in_review";
  request.reviewReason = text;
  log(request, { type: "sent_to_review", reason: text });
  return { ok: true, status: "in_review", message: "Sent to a Paytrellis team member for review." };
}

// Ops staffer decision on a request in review.
export function decide(id, decision, note = "") {
  const request = mustGet(id);
  if (request.status !== "in_review") throw new RuleError(`${id} is ${request.status}, not in review`);
  if (decision !== "approve" && decision !== "reject") throw new RuleError(`Decision must be approve or reject`);

  request.status = decision === "approve" ? "approved" : "rejected";
  request.writeBack = { result: decision === "approve" ? "success" : "failed", at: new Date().toISOString() };
  log(request, { type: decision === "approve" ? "approved" : "rejected", note });
  return request;
}

export function attachConversation(id, conversationId) {
  const request = mustGet(id);
  request.conversationId = conversationId;
  log(request, { type: "conversation_created", conversationId });
  return request;
}
