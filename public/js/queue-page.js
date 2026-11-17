// Ops queue page: lists payment requests, refreshes every few seconds so calls
// show up live, and lets a staffer approve or reject requests sent to review.
import { renderQueue, renderTranscript, counts } from "./queue.mjs";

const $ = (id) => document.getElementById(id);
const openTranscripts = new Set();
const transcriptCache = new Map();

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function showError(message) {
  $("error").hidden = !message;
  $("error").textContent = message ?? "";
}

async function load() {
  try {
    const requests = await api("/api/requests");
    const c = counts(requests);
    $("counts").textContent = `${c.review} need review · ${c.open} need info · ${c.done} closed`;
    $("rows").innerHTML = renderQueue(requests, openTranscripts);
    for (const id of openTranscripts) {
      const slot = $(`transcript-${id}`);
      if (slot && transcriptCache.has(id)) slot.innerHTML = transcriptCache.get(id);
    }
    showError(null);
  } catch (err) {
    showError(`Couldn't load the queue: ${err.message}`);
  }
}

async function toggleTranscript(id) {
  if (openTranscripts.has(id)) {
    openTranscripts.delete(id);
    return load();
  }
  openTranscripts.add(id);
  transcriptCache.set(id, `<div class="transcript muted">Loading transcript…</div>`);
  await load();
  try {
    transcriptCache.set(id, renderTranscript(await api(`/api/requests/${id}/transcript`)));
  } catch (err) {
    transcriptCache.set(id, `<div class="transcript muted">${err.message}</div>`);
  }
  await load();
}

$("rows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  button.disabled = true;
  try {
    if (action === "transcript") return await toggleTranscript(id);
    await api(`/api/requests/${id}/decision`, { method: "POST", body: JSON.stringify({ decision: action }) });
    await load();
  } catch (err) {
    showError(err.message);
    button.disabled = false;
  }
});

$("reset").addEventListener("click", async () => {
  openTranscripts.clear();
  transcriptCache.clear();
  await api("/api/reset", { method: "POST" });
  await load();
});

load();
setInterval(load, 4000);
