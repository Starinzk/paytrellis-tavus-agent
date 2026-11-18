// Ops queue page. Polls every few seconds so calls show up live, but only redraws
// when the data actually changed, and puts keyboard focus back where it was.
import { renderQueue, renderTabs, renderTranscript, counts } from "./queue.mjs";

const $ = (id) => document.getElementById(id);

const ui = {
  tab: null,
  expanded: new Set(),
  verified: new Set(),
  notes: new Map(),
  transcripts: new Map(),
  errors: new Map(),
};
let requests = [];
let lastSignature = "";

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server returned ${res.status}.`);
  return body;
}

function showError(message) {
  $("error").hidden = !message;
  $("error").textContent = message ?? "";
}

// Redraw, then restore focus (and the caret in a text box) to the same control.
function draw() {
  const active = document.activeElement;
  const focusKey = active?.dataset?.focus;
  const caret = active?.selectionStart;

  $("tabs").innerHTML = renderTabs(requests, ui.tab);
  $("rows").innerHTML = renderQueue(requests, ui);

  if (focusKey) {
    const el = document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    el?.focus();
    if (el && caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret);
  }
}

async function load({ force = false } = {}) {
  try {
    requests = await api("/api/requests");
    if (!ui.tab) ui.tab = location.hash.slice(1) || (counts(requests).review ? "review" : "info");
    const signature = JSON.stringify(requests);
    if (force || signature !== lastSignature) {
      lastSignature = signature;
      draw();
    }
    $("updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
    showError(null);
  } catch (err) {
    showError(`The queue couldn't refresh: ${err.message} It will retry automatically.`);
  }
}

async function decide(id, decision) {
  ui.errors.delete(id);
  try {
    await api(`/api/requests/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note: ui.notes.get(id) ?? "", verifiedBankChange: ui.verified.has(id) }),
    });
    ui.notes.delete(id);
    ui.verified.delete(id);
  } catch (err) {
    ui.errors.set(id, err.message);
  }
  await load({ force: true });
}

async function loadTranscript(id) {
  ui.transcripts.set(id, `<p class="muted" style="margin:0">Loading transcript…</p>`);
  draw();
  try {
    ui.transcripts.set(id, renderTranscript(await api(`/api/requests/${id}/transcript`)));
  } catch (err) {
    ui.transcripts.set(id, `<p class="muted" style="margin:0">${err.message}</p>`);
  }
  draw();
}

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const { action, id, tab } = el.dataset;
  if (action === "tab") {
    ui.tab = tab;
    history.replaceState(null, "", `#${tab}`);
    draw();
  } else if (action === "toggle") {
    if (ui.expanded.has(id)) ui.expanded.delete(id);
    else ui.expanded.add(id);
    draw();
  } else if (action === "approve" || action === "reject") {
    el.disabled = true;
    decide(id, action);
  } else if (action === "transcript") {
    loadTranscript(id);
  } else if (action === "copy-link") {
    copyCallLink(el, id);
  }
});

// The link the employee pastes into a calendar invite to the customer.
async function copyCallLink(button, id) {
  const url = `${location.origin}/call.html?request=${encodeURIComponent(id)}`;
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "Link copied";
    setTimeout(() => (button.textContent = "Copy call link"), 2000);
  } catch {
    window.prompt("Copy this link into the calendar invite:", url);
  }
}

// Ticking the verification box enables Approve without a redraw.
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset?.action !== "verify") return;
  if (el.checked) ui.verified.add(el.dataset.id);
  else ui.verified.delete(el.dataset.id);
  const approve = document.querySelector(`[data-action="approve"][data-id="${CSS.escape(el.dataset.id)}"]`);
  if (approve) approve.disabled = !el.checked;
});

document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset?.action === "note") ui.notes.set(el.dataset.id, el.value);
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Reset all demo payments to their starting state?")) return;
  for (const key of ["expanded", "verified"]) ui[key].clear();
  for (const key of ["notes", "transcripts", "errors"]) ui[key].clear();
  await api("/api/reset", { method: "POST" });
  await load({ force: true });
});

load();
setInterval(load, 4000);
