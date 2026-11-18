# Paytrellis payment-request agent

A Tavus Conversational Video Interface (CVI) agent for **Paytrellis, a fictional payments company** that pays vendor invoices for its business customers. When a payment request is incomplete or mistyped, the agent calls the customer, checks the request against the vendor's invoice on a shared screen, and either completes it or hands it to an ops staffer.

Built as a take-home project for the Tavus Customer Engineer role. All company names, people, invoices and account numbers are invented.

## Status

- Screen-reading risk test: passed (all five invoice fields read correctly).
- Payment-request data, business rules and server: done.
- Agent setup (prompt, tools, guardrails, objective, call creation): done.
- Call page with live checklist: done.
- Ops queue with review, approve/reject and transcripts: done.

## How it's built

| Part | File | Role |
| --- | --- | --- |
| Payment requests | `data/requests.json` | Eight fictional requests, each with one or two flawed fields |
| Store | `lib/store.mjs` | Stand-in for Paytrellis's API, and where the business rules live |
| Server | `lib/app.mjs`, `server.mjs` | Serves the pages and runs the agent's tool calls against the store |
| Vendor portal | `vendor-portal/` | Fictional invoices the customer shares on screen |
| Agent definition | `agent/definitions.mjs` | Prompt, Raven-2 screen perception, tools, guardrails, objective |
| Agent setup | `agent/setup-agent.mjs` | Pushes the definition to Tavus; safe to re-run |
| Call context | `lib/call-context.mjs` | Per-call greeting and context built from the request |
| Call page | `public/call.html`, `public/js/call.js` | Embeds the call (Daily Prebuilt, which has the screen-share button) and shows the live checklist |
| Tool relay | `public/js/tool-relay.mjs` | Turns `conversation.tool_call` events into server calls and sends `conversation.tool_result` back |
| Ops queue | `public/index.html`, `public/js/queue.mjs` | Requests on hold, what changed on each call, approve/reject for reviews, transcripts |

The rules that decide whether money moves are enforced in `lib/store.mjs`, not in the agent's prompt:

- A request can't complete while any field is missing or flagged.
- A remit-to bank or account that differs from the vendor's details on file is marked `changed`, and the request can then only go to an ops staffer for review.
- Closed requests can't be changed by the agent.

## Setup

Requires Node.js 20.6 or newer (`node -v` to check).

```bash
cp .env.example .env
# open .env and paste your Tavus API key
```

## Run the app

```bash
npm install
npm run setup-agent   # once, and again after changing agent/definitions.mjs
npm start             # http://localhost:3000 (ops queue); calls open from there
```

`setup-agent` creates three guardrails, one objective, three tools and the PAL in your Tavus account and records their IDs in `.agent.json` (git-ignored). Re-running it reuses the guardrails and objective, updates the tools in place, and replaces the PAL so prompt changes take effect.

## The agent

- **Tools** (delivered to the call page as `conversation.tool_call` events, run against `lib/store.mjs`, returned as `conversation.tool_result`):
  - `update_field(field, value)`: saves a value after the customer confirms it out loud
  - `complete_request()`: submits the request; the server refuses if any rule fails
  - `send_to_review(reason)`: hands the request to an ops staffer
- **Tool calls carry no request ID.** The call page knows which request it's for, so the agent can only ever change the request it's calling about.
- **Perception:** Raven-2 with screen questions about invoice fields. The post-call report is scoped to the invoice, because in the risk test the default report also described the person and their surroundings.
- **Guardrails:** no credentials, no claiming a payment is complete unless the server said so, stay on task.
- **Approving new bank details** requires the ops staffer to confirm they verified them with the vendor on a phone number already on file. The server enforces this, not just the page.
- **Calls** are capped at 10 minutes with short idle timeouts to protect Tavus minutes.

## Checks

```bash
npm run check   # syntax-checks every script
npm run lint    # ESLint
npm test        # runs the tests in test/
```

Both run automatically on every pull request (`.github/workflows/ci.yml`).

## Screen-reading test

```bash
npm run risk-test            # creates a test agent and prints a call link (5-minute cap)
open vendor-portal/invoice-1042.html   # the invoice to share on screen
npm run risk-test:results    # after the call: transcript and Raven's screen report
npm run risk-test:end        # ends the call early if needed
```
