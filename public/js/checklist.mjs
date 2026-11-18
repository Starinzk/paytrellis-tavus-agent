// Turns a payment request into the call page's comparison ledger:
// what the customer submitted vs what was confirmed on the call, field by field.
// Pure so it can be tested in Node.

export const FIELD_LABELS = {
  invoiceNumber: "Invoice number",
  amount: "Amount",
  vendorAccount: "Vendor account",
  remitBank: "Remit-to bank",
  remitAccount: "Remit-to account",
};

export function formatValue(key, value) {
  if (value == null || value === "") return null;
  if (key === "amount") return Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return String(value);
}

// state: "needs" (to confirm), "locked" (confirmed), "flagged" (changed: a person will verify), "ok" (not flagged)
export function ledgerRows(request) {
  return Object.entries(request.fields).map(([key, f]) => {
    const requested = formatValue(key, "requested" in f ? f.requested : f.value);
    const current = formatValue(key, f.value);
    const touched = f.status === "confirmed" || f.status === "changed";
    const state =
      f.status === "missing" || f.status === "suspect"
        ? "needs"
        : f.status === "confirmed"
          ? "locked"
          : f.status === "changed"
            ? "flagged"
            : "ok";
    const tag = {
      needs: { label: f.status === "missing" ? "Missing" : "Check this", tone: "hold" },
      locked: { label: "Confirmed", tone: "confirmed" },
      flagged: { label: "Team will verify", tone: "review" },
      ok: null,
    }[state];
    return {
      key,
      label: FIELD_LABELS[key] ?? key,
      requested,
      confirmed: touched ? current : null,
      corrected: touched && current !== requested,
      // "Missing" already says the field was blank, so only suspect and changed fields carry a note.
      note: (f.status === "suspect" || state === "flagged") ? (f.note ?? null) : null,
      state,
      tag,
    };
  });
}

export function progress(request) {
  const rows = ledgerRows(request).filter((r) => r.state !== "ok");
  return { done: rows.filter((r) => r.state !== "needs").length, total: rows.length };
}

export const OUTCOMES = {
  completed: {
    title: "You're all set",
    body: "Every detail is confirmed and your payment is on its way to the vendor. You can close this page.",
    tone: "confirmed",
  },
  approved: { title: "Approved", body: "A Paytrellis team member approved this payment.", tone: "confirmed" },
  in_review: {
    title: "A Paytrellis team member will verify this",
    body: "We'll check the new details with the vendor before anything is paid, and email you once it's done. You can close this page.",
    tone: "review",
  },
  rejected: { title: "Payment not sent", body: "A Paytrellis team member couldn't verify these details. They'll contact you directly.", tone: "danger" },
  needs_info: {
    title: "Some details still need confirming",
    body: "Start another call whenever you're ready. Anything you confirmed has been saved.",
    tone: "hold",
  },
};

export function outcome(request) {
  return OUTCOMES[request.status] ?? null;
}

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function cell(value, { corrected, blankText }) {
  if (value == null) return `<span class="value blank">${escape(blankText)}</span>`;
  return `<span class="value">${corrected ? "<strong>" : ""}${escape(value)}${corrected ? "</strong>" : ""}</span>`;
}

export function renderLedger(request, justLocked = new Set()) {
  return ledgerRows(request)
    .map((r) => {
      const confirmedBlank = r.state === "ok" ? "No change needed" : "Waiting";
      return `
      <tr class="${r.state}${justLocked.has(r.key) ? " just-locked" : ""}" data-field="${r.key}">
        <td><div class="field">${escape(r.label)}</div>${r.tag ? `<span class="tag ${r.tag.tone}">${escape(r.tag.label)}</span>` : ""}</td>
        <td>${cell(r.requested, { corrected: false, blankText: "Left blank" })}${r.state === "needs" && r.note ? `<span class="note">${escape(r.note)}</span>` : ""}</td>
        <td>${cell(r.confirmed, { corrected: r.corrected, blankText: confirmedBlank })}${r.state === "flagged" && r.note ? `<span class="note">${escape(r.note)}</span>` : ""}</td>
      </tr>`;
    })
    .join("");
}
