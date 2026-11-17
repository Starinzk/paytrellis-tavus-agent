// View model and rendering for the ops queue. Pure so it can be tested in Node.
import { FIELD_LABELS, formatValue } from "./checklist.mjs";

export const STATUS = {
  needs_info: { label: "Needs info", tone: "warn" },
  in_call: { label: "On a call", tone: "neutral" },
  in_review: { label: "Needs review", tone: "review" },
  completed: { label: "Completed", tone: "good" },
  approved: { label: "Approved", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
};

// Review first, then open, then closed; newest first within each group.
const ORDER = { in_review: 0, in_call: 1, needs_info: 2, completed: 3, approved: 3, rejected: 3 };

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function issues(request) {
  return Object.entries(request.fields)
    .filter(([, f]) => ["missing", "suspect", "changed"].includes(f.status))
    .map(([key, f]) => ({
      field: FIELD_LABELS[key] ?? key,
      kind: f.status === "missing" ? "Missing" : f.status === "suspect" ? "Doesn't look right" : "Changed",
      note: f.note ?? "",
    }));
}

// What the agent changed on the call, as old -> new. Last update per field wins.
export function changes(request) {
  const latest = new Map();
  for (const h of request.history ?? []) {
    if (h.type !== "field_updated") continue;
    const first = latest.get(h.field)?.from ?? h.from;
    latest.set(h.field, { field: h.field, from: first, to: h.to, status: h.status });
  }
  return [...latest.values()].map((c) => ({
    field: FIELD_LABELS[c.field] ?? c.field,
    from: formatValue(c.field, c.from),
    to: formatValue(c.field, c.to),
    flagged: c.status === "changed",
  }));
}

export function queueRows(requests) {
  return [...requests]
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.submittedAt.localeCompare(a.submittedAt))
    .map((r) => {
      const changed = changes(r);
      const changedFields = new Set(changed.map((c) => c.field));
      return {
      id: r.id,
      customer: r.customer.name,
      contact: r.customer.contact,
      vendor: r.vendor.name,
      amount: formatValue("amount", r.fields.amount.value),
      status: STATUS[r.status] ?? { label: r.status, tone: "neutral" },
      // A field the agent already changed is shown under "Changed on call" instead.
      issues: issues(r).filter((i) => !changedFields.has(i.field)),
      changes: changed,
      reviewReason: r.reviewReason ?? null,
      writeBack: r.writeBack ?? null,
      canCall: r.status === "needs_info",
      canDecide: r.status === "in_review",
      hasCall: Boolean(r.conversationId),
      };
    });
}

export function counts(requests) {
  const c = { open: 0, review: 0, done: 0 };
  for (const r of requests) {
    if (r.status === "needs_info" || r.status === "in_call") c.open++;
    else if (r.status === "in_review") c.review++;
    else c.done++;
  }
  return c;
}

function renderRow(row, openTranscripts) {
  const issueList = row.issues.length
    ? `<ul class="changes">${row.issues.map((i) => `<li><strong>${escape(i.field)}</strong>: ${escape(i.kind)}${i.note ? ` <span class="muted">(${escape(i.note)})</span>` : ""}</li>`).join("")}</ul>`
    : row.changes.length ? "" : `<span class="muted">None</span>`;

  const changeList = row.changes.length
    ? `<ul class="changes">${row.changes.map((c) => `<li>${escape(c.field)}: <s>${escape(c.from)}</s> → <strong>${escape(c.to)}</strong>${c.flagged ? ' <span class="pill review">differs from file</span>' : ""}</li>`).join("")}</ul>`
    : "";

  const writeBack = row.writeBack
    ? `<div class="muted" style="margin-top:6px">Written back to portal: <strong>${escape(row.writeBack.result)}</strong></div>`
    : "";

  const actions = [
    row.canCall ? `<a class="btn small" href="/call.html?request=${escape(row.id)}">Start call</a>` : "",
    row.canDecide ? `<button class="btn small" data-action="approve" data-id="${escape(row.id)}">Approve</button>` : "",
    row.canDecide ? `<button class="btn small secondary" data-action="reject" data-id="${escape(row.id)}">Reject</button>` : "",
    row.hasCall ? `<button class="btn small secondary" data-action="transcript" data-id="${escape(row.id)}">${openTranscripts.has(row.id) ? "Hide transcript" : "Transcript"}</button>` : "",
  ].join("");

  return `
    <tr class="${row.canDecide ? "review-row" : ""}">
      <td><strong>${escape(row.id)}</strong><div class="muted">${escape(row.contact)}</div></td>
      <td>${escape(row.customer)}<div class="muted">pays ${escape(row.vendor)}</div></td>
      <td>${escape(row.amount)}</td>
      <td><span class="pill ${row.status.tone}">${escape(row.status.label)}</span>${row.reviewReason ? `<div class="muted" style="margin-top:6px">${escape(row.reviewReason)}</div>` : ""}${writeBack}</td>
      <td>${issueList}${changeList ? `<div class="muted" style="${issueList ? "margin-top:8px" : ""}">Changed on call</div>${changeList}` : ""}</td>
      <td><div class="actions">${actions}</div><div id="transcript-${escape(row.id)}"></div></td>
    </tr>`;
}

export function renderQueue(requests, openTranscripts = new Set()) {
  return queueRows(requests).map((row) => renderRow(row, openTranscripts)).join("");
}

export function renderTranscript({ transcript, perception }) {
  if (!transcript?.length && !perception) {
    return `<div class="transcript muted">Transcript not ready yet. Tavus saves it shortly after the call ends.</div>`;
  }
  const turns = transcript
    .map((t) => `<p><span class="who">${t.role === "assistant" ? "Paige" : "Customer"}:</span> ${escape(t.content)}</p>`)
    .join("");
  const screen = perception ? `<p class="muted"><span class="who">Screen report:</span> ${escape(perception)}</p>` : "";
  return `<div class="transcript">${turns}${screen}</div>`;
}
