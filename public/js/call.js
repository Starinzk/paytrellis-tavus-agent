// Customer call page: embeds the Tavus video call (Daily Prebuilt, which includes
// the screen-share button), relays the agent's tool calls to our server, and keeps
// the checklist in sync.
import { handleToolCall } from "./tool-relay.mjs";
import { renderChecklist, progress, outcome, FIELD_LABELS } from "./checklist.mjs";

const params = new URLSearchParams(location.search);
const requestId = params.get("request");
const $ = (id) => document.getElementById(id);

let request = null;
let frame = null;
let inCall = false;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function money(n) {
  return n == null ? "amount missing" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function addActivity(text, isError = false) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · ${text}`;
  if (isError) li.className = "error";
  $("activity").prepend(li);
}

function render(changedField) {
  $("title").textContent = `${request.customer.name} → ${request.vendor.name}`;
  $("meta").textContent = `Request ${request.id} · ${money(request.fields.amount.value)} · contact ${request.customer.contact}`;
  $("checklist").innerHTML = renderChecklist(request);

  const { done, total } = progress(request);
  $("progress-label").textContent = total ? `${done} of ${total} details confirmed` : "No details flagged";
  $("progress-bar").style.width = total ? `${(done / total) * 100}%` : "100%";

  const open = request.status === "needs_info" || request.status === "in_call";
  const box = $("outcome");
  box.hidden = request.status === "needs_info" || request.status === "in_call";
  if (!box.hidden) {
    const o = outcome(request);
    box.className = `outcome ${o.tone}`;
    box.querySelector("h2").textContent = o.title;
    box.querySelector("p").textContent = request.reviewReason ? `${o.body} Reason: ${request.reviewReason}` : o.body;
  }
  $("start").disabled = !open || inCall;

  if (request.demoInvoice) {
    $("demo-invoice").hidden = false;
    $("demo-invoice").querySelector("a").href = request.demoInvoice;
  }

  if (changedField) {
    const row = document.querySelector(`[data-field="${changedField}"]`);
    row?.classList.add("flash");
    setTimeout(() => row?.classList.remove("flash"), 1500);
  }
}

async function refresh(changedField) {
  const { status, body } = await api(`/api/requests/${requestId}`);
  if (status !== 200) throw new Error(body.error ?? `Couldn't load request ${requestId}`);
  request = body;
  render(changedField);
}

function describeTool({ name, args, status, output }) {
  if (name === "update_field") return `${FIELD_LABELS[args.field] ?? args.field} → ${args.value}: ${output}`;
  if (name === "complete_request") return `Submit request: ${output}`;
  if (name === "send_to_review") return `Sent to review (${args.reason ?? "no reason"}): ${output}`;
  return `${name}: ${output}`;
}

async function startCall() {
  $("start").disabled = true;
  $("start-status").textContent = "Starting the call…";
  const { status, body } = await api(`/api/requests/${requestId}/call`, { method: "POST" });
  if (status !== 200) {
    $("start-status").textContent = body.error ?? "Couldn't start the call.";
    $("start").disabled = false;
    return;
  }

  inCall = true;
  addActivity("Call started");
  $("placeholder").hidden = true;
  frame = window.Daily.createFrame($("stage"), {
    iframeStyle: { width: "100%", height: "100%", border: "0" },
    showLeaveButton: true,
    showFullscreenButton: true,
  });

  frame.on("app-message", (event) =>
    handleToolCall(event?.data, {
      runTool: (name, args) =>
        api(`/api/requests/${requestId}/tools/${name}`, { method: "POST", body: JSON.stringify(args) }),
      send: (payload) => frame.sendAppMessage(payload, "*"),
      log: async (entry) => {
        addActivity(describeTool(entry), entry.status === "error");
        await refresh(entry.name === "update_field" ? entry.args.field : undefined);
      },
    }),
  );

  frame.on("left-meeting", endCall);
  frame.on("error", (e) => addActivity(`Call error: ${e?.errorMsg ?? "unknown"}`, true));

  await frame.join({ url: body.conversation_url });
  await refresh();
}

async function endCall() {
  if (!inCall) return;
  inCall = false;
  addActivity("Call ended");
  await api(`/api/requests/${requestId}/end-call`, { method: "POST" });
  frame?.destroy();
  frame = null;
  $("placeholder").hidden = false;
  $("start-status").textContent = "";
  await refresh();
}

// If the tab closes mid-call, still end the Tavus conversation so it stops billing.
window.addEventListener("pagehide", () => {
  if (inCall) navigator.sendBeacon(`/api/requests/${requestId}/end-call`);
});

$("start").addEventListener("click", () => startCall().catch((e) => addActivity(e.message, true)));

if (!requestId) {
  $("title").textContent = "No payment request selected";
  $("meta").innerHTML = 'Open a request from the <a href="/">ops queue</a>.';
} else {
  refresh().catch((e) => {
    $("title").textContent = "Couldn't load this request";
    $("meta").textContent = e.message;
  });
}
