// View model and rendering for the ops queue. Pure so it can be tested in Node.
import { FIELD_LABELS, formatValue } from "./checklist.mjs";

export const STATUS = {
  needs_info: { label: "Needs info", tone: "hold" },
  in_call: { label: "On a call", tone: "neutral" },
  in_review: { label: "Needs review", tone: "review" },
  completed: { label: "Completed", tone: "confirmed" },
  approved: { label: "Approved", tone: "confirmed" },
  rejected: { label: "Rejected", tone: "danger" },
};

export const TABS = [
  { id: "review", label: "Needs review" },
  { id: "info", label: "Needs info" },
  { id: "closed", label: "Closed" },
];

export function tabOf(request) {
  if (request.status === "in_review") return "review";
  if (request.status === "needs_info" || request.status === "in_call") return "info";
  return "closed";
}

const DAY = 86_400_000;

export function daysOnHold(request, now = Date.now()) {
  return Math.max(0, Math.floor((now - Date.parse(request.submittedAt)) / DAY));
}

function ageLabel(days) {
  if (days === 0) return "Today";
  return days === 1 ? "1 day on hold" : `${days} days on hold`;
}

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function issues(request) {
  return Object.entries(request.fields)
    .filter(([, f]) => ["missing", "suspect", "changed"].includes(f.status))
    .map(([key, f]) => ({
      key,
      field: FIELD_LABELS[key] ?? key,
      kind: f.status === "missing" ? "missing" : f.status === "suspect" ? "doesn't look right" : "changed",
      note: f.note ?? "",
    }));
}

// What the agent changed on the call, as submitted -> latest. Last update per field wins.
export function changes(request) {
  const latest = new Map();
  for (const h of request.history ?? []) {
    if (h.type !== "field_updated") continue;
    const first = latest.get(h.field)?.from ?? h.from;
    latest.set(h.field, { key: h.field, from: first, to: h.to, status: h.status });
  }
  return [...latest.values()]
    .filter((c) => c.from !== c.to || c.status === "changed")
    .map((c) => ({
      key: c.key,
      field: FIELD_LABELS[c.key] ?? c.key,
      from: formatValue(c.key, c.from) ?? "blank",
      to: formatValue(c.key, c.to),
      flagged: c.status === "changed",
    }));
}

// Remit-to details on file vs the new ones, for the bank-change review.
export function bankChange(request) {
  const rows = [];
  for (const key of ["remitBank", "remitAccount"]) {
    const f = request.fields[key];
    if (f?.status !== "changed") continue;
    const onFile = key === "remitBank" ? request.vendor.remitOnFile.bank : request.vendor.remitOnFile.account;
    rows.push({ field: FIELD_LABELS[key], onFile, proposed: f.value });
  }
  return rows;
}

export function problemSummary(request) {
  if (bankChange(request).length) return "New bank details for this vendor";
  const list = issues(request);
  if (!list.length) {
    if (request.status === "in_review") return request.reviewReason ?? "Sent for review";
    if (request.status === "needs_info") return "Details confirmed, not yet submitted";
    return "";
  }
  return list.map((i, n) => `${n ? i.field.toLowerCase() : i.field} ${i.kind}`).join(", ");
}

export function queueRows(requests, now = Date.now()) {
  return [...requests]
    .sort((a, b) => daysOnHold(b, now) - daysOnHold(a, now) || a.id.localeCompare(b.id))
    .map((r) => {
      const days = daysOnHold(r, now);
      const tab = tabOf(r);
      const changed = changes(r);
      const changedKeys = new Set(changed.map((c) => c.key));
      return {
        id: r.id,
        tab,
        customer: r.customer.name,
        contact: r.customer.contact,
        vendor: r.vendor.name,
        amount: formatValue("amount", r.fields.amount.value) ?? "Missing",
        status: STATUS[r.status] ?? { label: r.status, tone: "neutral" },
        age: tab === "closed" ? "" : ageLabel(days),
        old: tab !== "closed" && days >= 3,
        problem: problemSummary(r),
        // A field the agent already changed is shown under "Changed on the call" instead.
        issues: issues(r).filter((i) => !changedKeys.has(i.key)),
        changes: changed,
        bankChange: bankChange(r),
        reviewReason: r.reviewReason ?? null,
        writeBack: r.writeBack ?? null,
        canCall: r.status === "needs_info",
        canDecide: r.status === "in_review",
        hasCall: Boolean(r.conversationId),
      };
    });
}

export function counts(requests) {
  const c = { review: 0, info: 0, closed: 0 };
  for (const r of requests) c[tabOf(r)]++;
  return c;
}

export function renderTabs(requests, active) {
  const c = counts(requests);
  return TABS.map(
    (t) =>
      `<button role="tab" id="tab-${t.id}" aria-selected="${t.id === active}" aria-controls="queue-panel" data-action="tab" data-tab="${t.id}" data-focus="tab-${t.id}">${escape(t.label)}<span class="n">${c[t.id]}</span></button>`,
  ).join("");
}

function detailPanels(row, ui) {
  const id = escape(row.id);
  const left = [];
  if (row.issues.length) {
    left.push(
      `<div class="panel"><h3>What's wrong</h3><ul class="list">${row.issues
        .map((i) => `<li><strong>${escape(i.field)}</strong> ${escape(i.kind)}${i.note ? `. <span class="muted">${escape(i.note)}</span>` : ""}</li>`)
        .join("")}</ul></div>`,
    );
  }
  if (row.changes.length) {
    left.push(
      `<div class="panel"><h3>Changed on the call</h3><ul class="list">${row.changes
        .map(
          (c) =>
            `<li>${escape(c.field)}: ${c.from === "blank" ? "added" : `<s>${escape(c.from)}</s> to`} <strong>${escape(c.to)}</strong>${c.flagged ? ' <span class="tag review">Differs from file</span>' : ""}</li>`,
        )
        .join("")}</ul></div>`,
    );
  }
  if (row.writeBack) {
    const done = row.writeBack.result === "success";
    left.push(
      `<div class="panel"><h3>Portal update</h3><p style="margin:0">Written back to the portal as <strong>${done ? "ready to pay" : "failed"}</strong>.</p></div>`,
    );
  }
  if (!left.length) left.push(`<div class="panel"><p class="muted" style="margin:0">Nothing flagged on this request.</p></div>`);

  const right = [];
  if (row.canDecide) {
    const verified = ui.verified.has(row.id);
    const needsVerify = row.bankChange.length > 0;
    const diff = needsVerify
      ? `<table class="diff"><thead><tr><th scope="col">Detail</th><th scope="col">On file</th><th scope="col">From the invoice</th></tr></thead><tbody>${row.bankChange
          .map((b) => `<tr><td>${escape(b.field)}</td><td>${escape(b.onFile)}</td><td class="new">${escape(b.proposed)}</td></tr>`)
          .join("")}</tbody></table>
        <label class="verify"><input type="checkbox" data-action="verify" data-id="${id}" data-focus="verify-${id}" ${verified ? "checked" : ""}>
          <span>I called the vendor on a phone number we already had on file, and they confirmed these bank details.</span></label>`
      : "";
    right.push(`<div class="panel"><h3>Review decision</h3>
      ${row.reviewReason ? `<p style="margin:0 0 10px">${escape(row.reviewReason)}</p>` : ""}
      ${diff}
      <label class="sr-only" for="note-${id}">Note for the audit trail</label>
      <input class="note-input" id="note-${id}" data-action="note" data-id="${id}" data-focus="note-${id}" placeholder="Note for the audit trail (optional)" value="${escape(ui.notes.get(row.id) ?? "")}">
      <div class="decision">
        <button class="btn small" data-action="approve" data-id="${id}" data-focus="approve-${id}" ${needsVerify && !verified ? "disabled" : ""}>Approve payment</button>
        <button class="btn small danger" data-action="reject" data-id="${id}" data-focus="reject-${id}">Reject</button>
      </div>
      ${ui.errors.get(row.id) ? `<div class="form-error" role="alert">${escape(ui.errors.get(row.id))}</div>` : ""}
    </div>`);
  }
  if (row.hasCall) {
    const t = ui.transcripts.get(row.id);
    right.push(
      `<div class="panel"><h3>Call transcript</h3>${t ?? `<button class="btn small secondary" data-action="transcript" data-id="${id}" data-focus="transcript-${id}">Load transcript</button>`}</div>`,
    );
  }
  if (row.canCall) {
    right.push(
      `<div class="panel"><h3>Next step</h3><p style="margin:0 0 10px">Send ${escape(row.contact)} a link to a short video call with Paige.</p><a class="btn small" href="/call.html?request=${id}">Open call page</a></div>`,
    );
  }
  return `<div class="detail-grid"><div>${left.join("")}</div><div>${right.join("")}</div></div>`;
}

const EMPTY = {
  review: "Nothing needs review. Requests Paige can't resolve on a call will appear here.",
  info: "No requests are waiting on customer details.",
  closed: "No closed requests yet.",
};

export function renderQueue(requests, ui = {}) {
  const state = {
    tab: ui.tab ?? "review",
    expanded: ui.expanded ?? new Set(),
    verified: ui.verified ?? new Set(),
    notes: ui.notes ?? new Map(),
    transcripts: ui.transcripts ?? new Map(),
    errors: ui.errors ?? new Map(),
  };
  const rows = queueRows(requests, ui.now).filter((r) => r.tab === state.tab);
  if (!rows.length) return `<tr><td colspan="6" class="empty">${escape(EMPTY[state.tab])}</td></tr>`;

  return rows
    .map((row) => {
      const id = escape(row.id);
      const open = state.expanded.has(row.id);
      return `
      <tr class="row${open ? " open" : ""}">
        <td class="c-id"><div class="req-id">${id}</div>${row.age ? `<div class="age${row.old ? " old" : ""}">${escape(row.age)}</div>` : ""}</td>
        <td class="c-party"><div class="party">${escape(row.customer)}</div><div class="party-sub">Paying ${escape(row.vendor)}</div></td>
        <td class="c-amount num">${escape(row.amount)}</td>
        <td class="c-problem">${row.problem ? escape(row.problem) : '<span class="muted">None</span>'}</td>
        <td class="c-status"><span class="tag ${row.status.tone}">${escape(row.status.label)}</span></td>
        <td class="c-action"><button class="expand" data-action="toggle" data-id="${id}" data-focus="toggle-${id}" aria-expanded="${open}">${open ? "Close" : row.canDecide ? "Review" : "Details"}</button></td>
      </tr>${open ? `<tr class="detail"><td colspan="6">${detailPanels(row, state)}</td></tr>` : ""}`;
    })
    .join("");
}

export function renderTranscript({ transcript, perception }) {
  if (!transcript?.length && !perception) {
    return `<p class="muted" style="margin:0">The transcript isn't ready yet. Tavus saves it shortly after the call ends.</p>`;
  }
  const turns = (transcript ?? [])
    .map((t) => `<p><span class="who">${t.role === "assistant" ? "Paige" : "Customer"}:</span> ${escape(t.content)}</p>`)
    .join("");
  const screen = perception ? `<div class="screen-report"><strong>What Paige saw on screen:</strong>\n${escape(perception)}</div>` : "";
  return `<div class="transcript">${turns}${screen}</div>`;
}
