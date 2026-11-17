// Prints what the agent said and Raven's post-call screen report for the test call.
import { tavus, loadState } from "./tavus.mjs";

const { conversation_id } = await loadState();
const convo = await tavus("GET", `/conversations/${conversation_id}?verbose=true`);

console.log(`\nConversation ${conversation_id}: status ${convo.status ?? "unknown"}\n`);

const events = convo.events ?? [];
const transcriptEvent = events.find((e) => e.event_type === "application.transcription_ready");
const perceptionEvent = events.find((e) => e.event_type === "application.perception_analysis");

if (transcriptEvent) {
  console.log("Transcript:");
  for (const turn of transcriptEvent.properties?.transcript ?? []) {
    if (turn.role === "system") continue;
    console.log(`  ${turn.role}: ${turn.content}`);
  }
} else {
  console.log("Transcript not ready yet. Wait a minute after the call ends and run this again.");
}

console.log("");
if (perceptionEvent) {
  console.log("Raven's post-call screen report:");
  console.log(JSON.stringify(perceptionEvent.properties, null, 2));
} else {
  console.log("Post-call screen report not ready yet (or not produced).");
}

console.log("\nExpected values (from vendor-portal/invoice-1042.html):");
console.log("  Invoice number: INV-1042");
console.log("  Total: $4,020.00");
console.log("  Vendor: Oakridge Fastener Supply, vendor account V-58213");
console.log("  Remit-to: Lakeshore Commerce Bank, account ending 7316\n");
