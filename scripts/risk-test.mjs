// Stage 2 risk test: can the agent read an invoice off a shared screen?
// Creates a throwaway PAL with Raven-2 screen perception, starts a short call,
// and prints the link to join.
import { tavus, requireEnv, saveState } from "./tavus.mjs";

const FIELDS = [
  "invoice number",
  "invoice total",
  "vendor name",
  "vendor account number",
  "remit-to bank details",
];

const pal = await tavus("POST", "/pals", {
  pal_name: "Paytrellis screen-reading test",
  pipeline_mode: "full",
  default_face_id: requireEnv("TAVUS_FACE_ID"),
  greeting:
    "Hi, this is a quick screen-reading test. Please share the tab with the invoice, and tell me when it's up.",
  system_prompt: [
    "You are a test assistant for Paytrellis, a fictional payments company.",
    "Your only job is to check whether you can read an invoice from the user's shared screen.",
    `When the user shares their screen, read back exactly: ${FIELDS.join(", ")}.`,
    "Read every number digit by digit. If anything is blurry or cut off, say so instead of guessing.",
    "Keep each reply short. Never ask for passwords, card numbers or bank logins.",
  ].join(" "),
  layers: {
    perception: {
      perception_model: "raven-2",
      screen_awareness_queries: [
        "What invoice number is shown on the shared screen?",
        "What is the invoice total or amount due shown on the shared screen?",
        "What vendor name and vendor account number are shown on the shared screen?",
        "What remit-to or bank payment details are shown on the shared screen?",
      ],
      perception_analysis_queries: [
        `List, exactly as they appeared on the shared screen: ${FIELDS.join(", ")}. Mark any field you could not read.`,
      ],
    },
  },
});

const conversation = await tavus("POST", "/conversations", {
  pal_id: pal.pal_id,
  conversation_name: "Paytrellis screen-reading test",
  properties: {
    max_call_duration: 300, // 5 minutes, to protect the free minutes
    participant_left_timeout: 20,
    participant_absent_timeout: 120,
  },
});

await saveState({
  pal_id: pal.pal_id,
  conversation_id: conversation.conversation_id,
  conversation_url: conversation.conversation_url,
  started_at: new Date().toISOString(),
});

console.log("\nTest call is live. It ends on its own after 5 minutes.\n");
console.log(`  Join here: ${conversation.conversation_url}\n`);
console.log("Then:");
console.log("  1. Open vendor-portal/invoice-1042.html in another browser tab.");
console.log("  2. In the call, share that tab and ask the agent to read the invoice.");
console.log("  3. Leave the call, wait a minute, then run: npm run risk-test:results\n");
