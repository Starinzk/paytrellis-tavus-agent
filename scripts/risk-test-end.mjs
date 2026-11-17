// Ends the test call early so it stops using minutes.
import { tavus, readJson } from "../lib/tavus.mjs";

const state = await readJson(new URL("../.risk-test.json", import.meta.url), null);
if (!state) throw new Error("No test call found. Run `npm run risk-test` first.");
await tavus("POST", `/conversations/${state.conversation_id}/end`);
console.log(`Ended conversation ${state.conversation_id}.`);
