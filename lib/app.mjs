// HTTP app: serves the pages and exposes the payment-request API used by the
// call page (tool calls) and the ops queue (decisions).
import express from "express";
import * as store from "./store.mjs";

const TOOLS = {
  update_field: (id, args) => store.updateField(id, args.field, args.value, "customer"),
  complete_request: (id) => store.completeRequest(id),
  send_to_review: (id, args) => store.sendToReview(id, args.reason),
};

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(express.static(new URL("../public", import.meta.url).pathname));
  app.use("/vendor-portal", express.static(new URL("../vendor-portal", import.meta.url).pathname));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/requests", (_req, res) => res.json(store.list()));

  app.get("/api/requests/:id", (req, res) => {
    const request = store.get(req.params.id);
    if (!request) return res.status(404).json({ error: `No payment request ${req.params.id}` });
    res.json(request);
  });

  // The call page relays each agent tool call here and sends the result back to Tavus.
  app.post("/api/requests/:id/tools/:tool", (req, res) => {
    const run = TOOLS[req.params.tool];
    if (!run) return res.status(404).json({ ok: false, error: `Unknown tool ${req.params.tool}` });
    try {
      res.json(run(req.params.id, req.body ?? {}));
    } catch (err) {
      if (err instanceof store.RuleError) return res.status(422).json({ ok: false, error: err.message });
      throw err;
    }
  });

  app.post("/api/requests/:id/decision", (req, res) => {
    try {
      res.json(store.decide(req.params.id, req.body?.decision, req.body?.note));
    } catch (err) {
      if (err instanceof store.RuleError) return res.status(422).json({ error: err.message });
      throw err;
    }
  });

  // Puts the demo data back to its starting state.
  app.post("/api/reset", (_req, res) => {
    store.reset();
    res.json({ ok: true });
  });

  return app;
}
