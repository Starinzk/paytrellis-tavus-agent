// Prints what the agent said and Raven's post-call screen report for the test call.
import { tavus, readJson, summarizeConversation } from "../lib/tavus.mjs";

const state = await readJson(new URL("../.risk-test.json", import.meta.url), null);
if (!state) throw new Error("No test call found. Run `npm run risk-test` first.");

const summary = summarizeConversation(await tavus("GET", `/conversations/${state.conversation_id}?verbose=true`));

console.log(`\nConversation ${state.conversation_id}: status ${summary.status}\n`);
if (summary.transcript.length) {
  console.log("Transcript:");
  for (const turn of summary.transcript) console.log(`  ${turn.role}: ${turn.content}`);
} else {
  console.log("Transcript not ready yet. Wait a minute after the call ends and run this again.");
}

console.log("");
console.log(summary.perception ? `Raven's post-call screen report:\n${summary.perception}` : "Post-call screen report not ready yet.");

console.log("\nExpected values (from vendor-portal/invoice-1042.html):");
console.log("  Invoice number: INV-1042");
console.log("  Total: $4,020.00");
console.log("  Vendor: Oakridge Fastener Supply, vendor account V-58213");
console.log("  Remit-to: Lakeshore Commerce Bank, account 4402 1186 7316\n");
