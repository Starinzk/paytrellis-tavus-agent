// Builds the per-call greeting and context from a payment on hold, so the agent
// opens by saying what it already knows instead of asking the customer to explain.
import { FIELDS } from "./store.mjs";
import { AGENT_NAME } from "../agent/definitions.mjs";

const money = (n) =>
  n == null ? null : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function display(key, value) {
  if (value == null) return "(blank)";
  return key === "amount" ? money(value) : value;
}

function firstName(contact) {
  return String(contact ?? "").split(" ")[0] || "there";
}

export function flaggedFields(request) {
  return Object.entries(request.fields)
    .filter(([, f]) => f.status === "missing" || f.status === "suspect")
    .map(([key]) => key);
}

// Short on purpose: participants can't interrupt the greeting.
export function buildGreeting(request) {
  const amount = request.fields.amount.value;
  const what = amount == null ? "payment" : `${money(amount)} payment`;
  const n = flaggedFields(request).length;
  const issue = n === 1 ? "one detail" : `${n} details`;
  return `Hi ${firstName(request.customer.contact)}, this is ${AGENT_NAME} from Paytrellis about your ${what} to ${request.vendor.name}. It's on hold because of ${issue} I need to check with you. Have you got a minute?`;
}

export function buildContext(request) {
  const lines = Object.entries(request.fields).map(([key, f]) => {
    const flag =
      f.status === "missing" ? "MISSING" : f.status === "suspect" ? "FLAGGED" : f.status.toUpperCase();
    const note = f.note ? `: ${f.note}` : "";
    return `- ${FIELDS[key]} (${key}): ${display(key, f.value)} [${flag}${note}]`;
  });
  return [
    `Payment ${request.id}: Paytrellis is paying ${request.vendor.name} on behalf of our customer ${request.customer.name} (contact: ${request.customer.contact}). It's on hold until the flagged details are confirmed.`,
    "Details the customer sent us for this payment:",
    ...lines,
    `Details you must get confirmed: ${flaggedFields(request).map((k) => `${FIELDS[k]} (${k})`).join(", ")}.`,
    "Details marked OK were sent with the payment; if the invoice shows something different for them, read it back and confirm it too.",
  ].join("\n");
}
