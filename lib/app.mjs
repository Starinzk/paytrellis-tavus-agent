// HTTP app: serves the pages and exposes the payment-request API used by the
// call page (calls, tool calls) and the ops queue (decisions, transcripts).
import express from "express";
import { createRequire } from "node:module";
import * as store from "./store.mjs";
import { tavus as defaultTavus, readJson, summarizeConversation } from "./tavus.mjs";
import { buildGreeting, buildContext } from "./call-context.mjs";

const TOOLS = {
  update_field: (id, args) => store.updateField(id, args.field, args.value, "customer"),
  complete_request: (id) => store.completeRequest(id),
  send_to_review: (id, args) => store.sendToReview(id, args.reason),
};

// Call limits: keep demo calls short so they don't burn Tavus minutes.
export const CALL_PROPERTIES = {
  max_call_duration: 600,
  participant_left_timeout: 20,
  participant_absent_timeout: 120,
};

const defaultAgent = () => readJson(new URL("../.agent.json", import.meta.url), null);

export function createApp({ tavus = defaultTavus, getAgent = defaultAgent } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.static(new URL("../public", import.meta.url).pathname));
  app.use("/vendor-portal", express.static(new URL("../vendor-portal", import.meta.url).pathname));

  // Brand typeface, self-hosted (pinned in package.json).
  const fontDir = createRequire(import.meta.url).resolve("@fontsource-variable/schibsted-grotesk/index.css").replace(/index\.css$/, "");
  app.use("/vendor/font", express.static(fontDir));

  // Daily's call SDK, served from node_modules (pinned in package.json) rather than a CDN.
  const dailyJs = createRequire(import.meta.url).resolve("@daily-co/daily-js/dist/daily.js");
  app.get("/vendor/daily.js", (_req, res) => res.sendFile(dailyJs));

  // Turns rule violations into 422s and everything else into 500s with a message.
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (err) {
      if (err instanceof store.RuleError) return res.status(422).json({ ok: false, error: err.message });
      console.error(err);
      res.status(err.status === 404 ? 404 : 500).json({ ok: false, error: err.message });
    }
  };

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/requests", (_req, res) => res.json(store.list()));

  app.get("/api/requests/:id", (req, res) => {
    const request = store.get(req.params.id);
    if (!request) return res.status(404).json({ error: `No payment request ${req.params.id}` });
    res.json(request);
  });

  // Starts a Tavus conversation for one payment request.
  app.post(
    "/api/requests/:id/call",
    handle(async (req) => {
      const agent = await getAgent();
      if (!agent?.pal_id) throw new Error("Agent isn't set up yet. Run `npm run setup-agent` first.");
      const request = store.get(req.params.id);
      if (!request) throw Object.assign(new Error(`No payment request ${req.params.id}`), { status: 404 });
      store.markInCall(request.id); // throws if the request isn't open

      const convo = await tavus("POST", "/conversations", {
        pal_id: agent.pal_id,
        conversation_name: `Paytrellis ${request.id} · ${request.customer.name}`,
        custom_greeting: buildGreeting(request),
        conversational_context: buildContext(request),
        properties: CALL_PROPERTIES,
      });
      store.attachConversation(request.id, convo.conversation_id);
      return { conversation_id: convo.conversation_id, conversation_url: convo.conversation_url };
    }),
  );

  // The call page relays each agent tool call here and sends the result back to Tavus.
  app.post(
    "/api/requests/:id/tools/:tool",
    handle(async (req, res) => {
      const run = TOOLS[req.params.tool];
      if (!run) {
        res.status(404);
        return { ok: false, error: `Unknown tool ${req.params.tool}` };
      }
      return run(req.params.id, req.body ?? {});
    }),
  );

  // The customer left: end the Tavus conversation and reopen anything unresolved.
  app.post(
    "/api/requests/:id/end-call",
    handle(async (req) => {
      const request = store.get(req.params.id);
      if (!request) throw Object.assign(new Error(`No payment request ${req.params.id}`), { status: 404 });
      if (request.conversationId) {
        try {
          await tavus("POST", `/conversations/${request.conversationId}/end`);
        } catch (err) {
          console.warn(`Couldn't end conversation ${request.conversationId}: ${err.message}`);
        }
      }
      return store.endCall(request.id);
    }),
  );

  // Transcript and post-call screen report for the request's last call.
  app.get(
    "/api/requests/:id/transcript",
    handle(async (req) => {
      const request = store.get(req.params.id);
      if (!request?.conversationId) throw Object.assign(new Error("No call for this request yet"), { status: 404 });
      return summarizeConversation(await tavus("GET", `/conversations/${request.conversationId}?verbose=true`));
    }),
  );

  app.post(
    "/api/requests/:id/decision",
    handle((req) =>
      store.decide(req.params.id, req.body?.decision, req.body?.note, {
        verifiedBankChange: req.body?.verifiedBankChange === true,
      }),
    ),
  );

  // Puts the demo data back to its starting state.
  app.post("/api/reset", (_req, res) => {
    store.reset();
    res.json({ ok: true });
  });

  return app;
}
