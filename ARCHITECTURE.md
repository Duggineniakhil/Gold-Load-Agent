# Architecture

## The idea

The form and the AI agent call the **same service functions**, so an application filed through chat is identical to one filed through the form. The server recomputes every number. Money is integer paise (`BigInt` in calculations), weights are integer milligrams, and LTV is applied in basis points, so nothing is ever a float.

```
 Browser (React + Vite)                         apps/web
 ┌──────────────────────────────────────────────────────────────────┐
 │ Home · Apply (3 steps, live quote) · Lead register + drawer      │
 │ Loan Assist chat (sheet + floating button)                       │
 └───────────────┬───────────────────────────────┬──────────────────┘
       REST /api/v1 (quotes, leads, status)       │ /api/v1/agent/*
 ┌───────────────▼───────────────────────────────▼──────────────────┐
 │ Express app (app.ts): parse with shared Zod → service → JSON     │  apps/api
 │ rate limits on POST /leads and /agent/* · one error shape        │
 │                                                                  │
 │  quote-service ── lead-service ── loan-scheme-service            │
 │        ▲               ▲               ▲                         │
 │        └───── agent tools (tools.ts) ──┘    gold-rate-service    │
 │                     ▲                       (60 s cache)         │
 │   agent-service: tool loop, number check, confirm gate           │
 │                     ▲                                            │
 │   LLM client: Gemini → Groq fallback (OpenAI-compatible fetch)   │
 │                                                                  │
 │  domain/money.ts: pure BigInt maths  ·  repositories: Prisma     │
 └───────────────────────────────┬──────────────────────────────────┘
                                 │ Prisma + advisory locks
 ┌───────────────────────────────▼──────────────────────────────────┐
 │ PostgreSQL: LoanScheme · Lead · LeadAuditLog · IdempotencyRecord │
 └──────────────────────────────────────────────────────────────────┘
 packages/shared: Zod schemas, status transitions and agent types used by API, agent and web
```

## Layers

| Layer | Where | Rule |
| --- | --- | --- |
| Shared contract | `packages/shared/src` | Zod schemas for every request, the status transition map and agent response types. The API, the agent tools and the form all validate with these. |
| Routes | `apps/api/src/app.ts` | Parse and validate, call one service, set headers. No business logic. |
| Services | `apps/api/src/services` | All rules: quotes, de-duplication, idempotency, status workflow, the agent loop, the cached gold rate. |
| Domain | `apps/api/src/domain` | Pure functions with no I/O: `money.ts` (exact maths), `idempotency.ts` (canonical request hash), `mobile.ts` (masking). |
| Repositories | `apps/api/src/repositories` | The only code that touches Prisma, including locks and conditional updates. |
| Agent | `apps/api/src/agent` | Tool definitions and executors, the system prompt, the number check, and the LLM clients. |

## Money

`calculateQuote` keeps the exact fraction `net_mg × karat × rate_paise / 24 / 1000` as `BigInt`. The loan is floored to whole rupees from that fraction (`floor(value × min(maxLtv, 75%))`), so rounding the gold value or the pure-gold figure first can never move it across a rupee. Pure gold and gold value are rounded half-up only for display. `BigInt` is converted to `number` at the API boundary, never serialised directly.

## Request flows

**Form.** `POST /quotes` computes every plan with no database write. `POST /leads` validates, takes advisory locks (`mobile:<number>`, plus `idempotency:<key>` when a key is sent; always in sorted order, so two requests cannot deadlock), checks the idempotency record, the plan and the 7-day window inside one transaction, recomputes the quote, inserts the lead, and stores the 201 response against the key.

**Agent.** `POST /agent/messages` runs a tool loop of up to 6 steps:

- `get_loan_schemes`, `calculate_quote` and `check_existing_application` run for real against the services.
- `submit_application` only returns a server-computed summary. The lead is filed only by `POST /agent/sessions/:id/confirm`, through the same `submitLead` as the form.
- Before any tool runs, the weights, karat and mobile number in its arguments must have been typed by the borrower (each typed number can back one field).
- Every number in the reply must appear in a tool result, the borrower's messages or the system prompt. Otherwise the model is asked to rewrite once, and then a fixed reply is used.
- A failed turn is rolled back, so the conversation stays valid.

**Streamed replies.** `POST /agent/messages/stream` returns Server-Sent Events. The agent completes its normal tool loop and number guard first; only the verified final reply is sent as incremental text chunks, followed by the turn metadata. This preserves the number-guard guarantee while allowing the chat UI to render an arriving reply.

**Appraisal slip.** `POST /appraisal-slip/extract` accepts a bounded JPEG, PNG or WebP data URL and calls the configured server-side multimodal model. Its response contains only validated weights and supported karat values (unreadable fields are `null`). The image is not persisted, and the form applies suggestions only after the borrower reviews them.

**Admin search.** The admin register parses supported plain-English filters (status, repayment type, karat, net weight, loan amount and name/application text) in the lead service. The repository applies these constraints before cursor pagination; currency thresholds stay in integer paise.

**Status workflow.** `PATCH /leads/:applicationId/status` checks the shared transition map, then runs `UPDATE … WHERE status = <current>` and inserts the audit row in one transaction. If another change won the race, the update matches no row and the request fails with `409 INVALID_TRANSITION`.

## Docker Compose

`docker compose up` starts PostgreSQL, the API and a production-built web app served by Nginx. The API waits for the database health check, applies migrations and seeds plans before listening. Nginx serves the SPA and proxies `/api/` to the API service; LLM credentials are injected only into the API container.

## LLM providers

The client is plain `fetch` against any OpenAI-compatible chat-completions endpoint.

- **Gemini (primary):** its tool calls carry `extra_content` thought signatures, which are kept and sent back unchanged.
- **Groq (fallback):** used only when Gemini is unavailable after one retry. It gets standard messages only, and fields such as its `reasoning` text are dropped from the response.
- Both providers accept a conversation the other started, so a single turn can fall back without breaking the session.

## Error contract

Every error is `{ error: { code, message, fields[] } }`, including malformed JSON (400), unknown routes (404), rate limits (429, with `Retry-After`) and unexpected errors (500, no stack trace). Some codes add context, such as `existing` for `DUPLICATE_APPLICATION`, or `from`, `to` and `allowed` for `INVALID_TRANSITION`. 5xx details are logged server-side only, and logs redact mobile numbers.

## Trade-offs

- **Advisory locks instead of a uniqueness constraint** for the 7-day rule. A rolling window cannot be expressed as a unique index.
- **In-memory agent sessions and rate-limit counters** keep the app to a single process. Both need Redis or PostgreSQL before running several instances.
- **No admin login.** The status change records the name the admin types; real authentication is the first thing to add.
