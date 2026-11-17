# Paytrellis payment-request agent

A Tavus Conversational Video Interface (CVI) agent for **Paytrellis, a fictional payments company** that pays vendor invoices for its business customers. When a payment request is incomplete or mistyped, the agent calls the customer, checks the request against the vendor's invoice on a shared screen, and either completes it or hands it to an ops staffer.

Built as a take-home project for the Tavus Customer Engineer role. All company names, people, invoices and account numbers are invented.

## Status

- Screen-reading risk test: passed (all five invoice fields read correctly).
- Payment-request data, business rules and server: done.
- Agent setup, call page and ops queue: in progress.

## How it's built

| Part | File | Role |
| --- | --- | --- |
| Payment requests | `data/requests.json` | Eight fictional requests, each with one or two flawed fields |
| Store | `lib/store.mjs` | Stand-in for Paytrellis's API, and where the business rules live |
| Server | `lib/app.mjs`, `server.mjs` | Serves the pages and runs the agent's tool calls against the store |
| Vendor portal | `vendor-portal/` | Fictional invoices the customer shares on screen |

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
npm start          # http://localhost:3000
```

## Checks

```bash
npm run check   # syntax-checks every script
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
