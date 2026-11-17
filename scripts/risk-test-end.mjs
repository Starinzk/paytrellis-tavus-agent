// Ends the test call early so it stops using minutes.
import { tavus, loadState } from "./tavus.mjs";

const { conversation_id } = await loadState();
await tavus("POST", `/conversations/${conversation_id}/end`);
console.log(`Ended conversation ${conversation_id}.`);
