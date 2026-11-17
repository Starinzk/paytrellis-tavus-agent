// Turns a payment request into checklist rows for the call page.
// Pure so it can be tested in Node.

export const FIELD_LABELS = {
  invoiceNumber: "Invoice number",
  amount: "Amount",
  vendorAccount: "Vendor account number",
  remitBank: "Remit-to bank",
  remitAccount: "Remit-to account number",
};

const STATUS = {
  missing: { label: "Missing", tone: "bad" },
  suspect: { label: "Doesn't look right", tone: "warn" },
  ok: { label: "On request", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "good" },
  changed: { label: "Changed: needs review", tone: "review" },
};

export function formatValue(key, value) {
  if (value == null || value === "") return "—";
  if (key === "amount") return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return String(value);
}

export function checklistRows(request) {
  return Object.entries(request.fields).map(([key, field]) => {
    const status = STATUS[field.status] ?? { label: field.status, tone: "neutral" };
    const wasChanged = "previous" in field && field.previous !== field.value;
    return {
      key,
      label: FIELD_LABELS[key] ?? key,
      value: formatValue(key, field.value),
      previous: wasChanged ? formatValue(key, field.previous) : null,
      note: field.note ?? null,
      statusLabel: status.label,
      tone: status.tone,
      needsAttention: field.status === "missing" || field.status === "suspect",
    };
  });
}

export function progress(request) {
  const rows = Object.values(request.fields);
  const flagged = rows.filter((f) => ["missing", "suspect"].includes(f.status) || "previous" in f);
  const done = flagged.filter((f) => !["missing", "suspect"].includes(f.status));
  return { done: done.length, total: flagged.length };
}

export const OUTCOMES = {
  completed: { title: "Payment request completed", body: "All details confirmed. The payment has been sent for processing.", tone: "good" },
  approved: { title: "Approved by Paytrellis", body: "A team member approved this request.", tone: "good" },
  in_review: { title: "Sent to a Paytrellis team member", body: "A person will verify the details before anything is paid.", tone: "review" },
  rejected: { title: "Rejected", body: "A team member rejected this request.", tone: "bad" },
  needs_info: { title: "Still open", body: "Some details still need confirming. You can start another call.", tone: "warn" },
  in_call: { title: "On a call", body: "", tone: "neutral" },
};

export function outcome(request) {
  return OUTCOMES[request.status] ?? { title: request.status, body: "", tone: "neutral" };
}

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderChecklist(request) {
  return checklistRows(request)
    .map(
      (r) => `
      <li class="row ${r.needsAttention ? "attention" : ""}" data-field="${r.key}">
        <div class="row-main">
          <span class="row-label">${escape(r.label)}</span>
          <span class="pill ${r.tone}">${escape(r.statusLabel)}</span>
        </div>
        <div class="row-value">
          ${r.previous ? `<s>${escape(r.previous)}</s> → ` : ""}<strong>${escape(r.value)}</strong>
        </div>
        ${r.note ? `<div class="row-note">${escape(r.note)}</div>` : ""}
      </li>`,
    )
    .join("");
}
