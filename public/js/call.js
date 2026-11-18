// Customer call page: embeds the Tavus video call (Daily Prebuilt, which includes
// the screen-share button), relays the agent's tool calls to our server, and keeps
// the comparison ledger in sync.
import { handleToolCall } from "./tool-relay.mjs";
import { renderLedger, progress, outcome, ledgerRows, FIELD_LABELS, formatValue } from "./checklist.mjs";

const requestId = new URLSearchParams(location.search).get("request");
const $ = (id) => document.getElementById(id);

let request = null;
let frame = null;
let inCall = false;
let activityStarted = false;
let accessCodeRequired = false;

// The access code is only needed on a hosted demo; remember it for this tab.
const savedCode = () => {
  try {
    return sessionStorage.getItem("demo-access-code") ?? "";
  } catch {
    return "";
  }
};
const saveCode = (code) => {
  try {
    sessionStorage.setItem("demo-access-code", code);
  } catch {
    /* storage unavailable: the code just won't be remembered */
  }
};

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function addActivity(text, isError = false) {
  if (!activityStarted) {
    $("activity").innerHTML = "";
    activityStarted = true;
  }
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
  li.append(time, text);
  if (isError) li.className = "error";
  $("activity").prepend(li);
}

function listJoin(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function render(justLocked = new Set()) {
  const amount = formatValue("amount", request.fields.amount.value);
  $("vendor").textContent = `Payment to ${request.vendor.name}`;
  $("amount").textContent = amount ?? "Amount to confirm";
  $("who").textContent = `From ${request.customer.name}, payment ${request.id}`;

  $("ledger").innerHTML = renderLedger(request, justLocked);
  const { done, total } = progress(request);
  $("count").textContent = total ? `${done} of ${total} confirmed` : "Nothing to confirm";
  $("meter").style.width = total ? `${(done / total) * 100}%` : "100%";

  const needed = ledgerRows(request).filter((r) => r.state === "needs").map((r) => r.label.toLowerCase());
  $("prep-title").textContent = `Let's get your payment to ${request.vendor.name} moving`;
  $("prep-needed").textContent = needed.length
    ? `We need to confirm the ${listJoin(needed)}. It usually takes about two minutes.`
    : "Everything on this payment is already confirmed.";

  const open = request.status === "needs_info" || request.status === "in_call";
  // Show the outcome once the payment is closed, or right after a call that left things open.
  const endedUnresolved = request.status === "needs_info" && request.history?.at(-1)?.type === "call_ended_unresolved";
  const o = !inCall && (!open || endedUnresolved) ? outcome(request) : null;
  $("outcome").hidden = !o;
  if (o) {
    $("outcome").className = `outcome ${o.tone}`;
    $("outcome").querySelector("h2").textContent = o.title;
    $("outcome").querySelector("p").textContent = o.body;
  }
  $("start").disabled = !open || inCall;
  $("start").textContent = request.history?.some((h) => h.type === "call_started") ? "Start another call" : "Start video call";

  if (request.demoInvoice) {
    $("demo-invoice-wrap").hidden = false;
    $("demo-invoice").href = request.demoInvoice;
  }
}

async function refresh(changedField) {
  const { status, body } = await api(`/api/requests/${requestId}`);
  if (status !== 200) throw new Error(body.error ?? `Couldn't load payment ${requestId}.`);
  request = body;
  render(changedField ? new Set([changedField]) : undefined);
}

function describeTool({ name, args, output }) {
  if (name === "update_field") return `${FIELD_LABELS[args.field] ?? args.field}: ${output}`;
  if (name === "complete_request") return `Releasing the payment. ${output}`;
  if (name === "send_to_review") return `Sent to a team member. ${output}`;
  return `${name}: ${output}`;
}

async function startCall() {
  const accessCode = $("access-code").value.trim();
  if (accessCodeRequired && !accessCode) {
    $("start-status").textContent = "Enter the access code from the email to start the call.";
    $("access-code").focus();
    return;
  }
  $("start").disabled = true;
  $("start-status").textContent = "Connecting you to Paige…";
  const { status, body } = await api(`/api/requests/${requestId}/call`, {
    method: "POST",
    body: JSON.stringify({ accessCode }),
  });
  if (status !== 200) {
    $("start-status").textContent = body.error ?? "The call couldn't start. Try again in a moment.";
    $("start").disabled = false;
    if (status === 401) $("access-code").focus();
    return;
  }
  if (accessCode) saveCode(accessCode);

  inCall = true;
  addActivity("Call started.");
  $("prep").hidden = true;
  $("start-status").textContent = "";
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
  frame.on("error", (e) => addActivity(`Call problem: ${e?.errorMsg ?? "unknown error"}.`, true));

  await frame.join({ url: body.conversation_url });
  await refresh();
}

async function endCall() {
  if (!inCall) return;
  inCall = false;
  addActivity("Call ended.");
  await api(`/api/requests/${requestId}/end-call`, { method: "POST" });
  frame?.destroy();
  frame = null;
  $("prep").hidden = false;
  await refresh();
}

// If the tab closes mid-call, still end the Tavus conversation so it stops billing.
window.addEventListener("pagehide", () => {
  if (inCall) navigator.sendBeacon(`/api/requests/${requestId}/end-call`);
});

$("start").addEventListener("click", () => startCall().catch((e) => addActivity(e.message, true)));

api("/api/config").then(({ body }) => {
  accessCodeRequired = Boolean(body.accessCodeRequired);
  $("access").hidden = !accessCodeRequired;
  $("access-code").value = savedCode();
});

if (!requestId) {
  $("vendor").textContent = "No payment selected.";
  $("prep-needed").textContent = "Open this page from the link in your email.";
} else {
  refresh().catch((e) => {
    $("vendor").textContent = "This payment couldn't be loaded.";
    $("who").textContent = e.message;
    $("prep-needed").textContent = "Check the link and try again.";
  });
}
