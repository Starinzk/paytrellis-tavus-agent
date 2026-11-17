# Paytrellis payment-request agent

A Tavus Conversational Video Interface (CVI) agent for **Paytrellis, a fictional payments company** that pays vendor invoices for its business customers. When a payment request is incomplete or mistyped, the agent calls the customer, checks the request against the vendor's invoice on a shared screen, and either completes it or hands it to an ops staffer.

Built as a take-home project for the Tavus Customer Engineer role. All company names, people, invoices and account numbers are invented.

## Status

Stage 2: screen-reading risk test. The full app comes next.

## Setup

Requires Node.js 20.6 or newer (`node -v` to check).

```bash
cp .env.example .env
# open .env and paste your Tavus API key
```

## Screen-reading test

```bash
npm run risk-test            # creates a test agent and prints a call link (5-minute cap)
open vendor-portal/invoice-1042.html   # the invoice to share on screen
npm run risk-test:results    # after the call: transcript and Raven's screen report
npm run risk-test:end        # ends the call early if needed
```
