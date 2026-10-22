# TGlobal Gold Loan Portal

A gold-loan intake portal for field agents and borrowers. Enter the gold's weight and karat to get a preliminary offer for every plan, then apply through a 3-step form or by chatting with **Loan Assist**, an AI agent that quotes and files applications by calling the backend's tools. Both paths use the same validated service layer and produce identical numbers. An admin register lists every application, with a status workflow and an audit trail.

AI tools, exact prompts and the AI mistakes that were caught are in [AI_LOG.md](AI_LOG.md).

## Tech choices and why

| Choice | Why |
| --- | --- |
| npm workspaces: `apps/api`, `apps/web`, `packages/shared` | One install. The shared package holds the Zod schemas, so the API, the form and the agent tools validate with exactly the same rules. |
| Node 20 + Express 5 + TypeScript | Express 5 forwards async errors to the error handler, so every failure returns the same JSON error shape. |
| Zod | Request validation and inferred types from one definition. Field errors map directly to `fields[]`. |
| PostgreSQL + Prisma | Migrations and a typed client. Money and weights are integers (paise as `BIGINT`, milligrams as `INT`), and `CHECK` constraints back up the rules in the database. |
| Integer maths with `BigInt` | No floats anywhere. The loan is `floor(goldValue × min(maxLtv, 75%))` in whole rupees, computed from the exact `karat/24` fraction, never from a rounded pure-gold figure. |
| PostgreSQL advisory locks | The 7-day duplicate check and the idempotency check hold under concurrent requests without a uniqueness trick. |
| React + Vite + `motion` | A fast single-page app. The UI calls the API for every figure and never computes money itself. |
| Vitest + Supertest + Playwright | Unit, API and database tests in one runner, plus a Playwright walkthrough at 375, 768 and 1440 px. |
| Gemini via its OpenAI-compatible API, using plain `fetch` | A free tier with tool calling, and no SDK lock-in: any OpenAI-compatible provider works by changing three env vars. |

## Prerequisites

- Node.js 20 or newer (npm 10)
- Docker with Compose, for PostgreSQL 16
- Optional: a Gemini API key, for Loan Assist and the live evals

## Setup

From a fresh clone:

```bash
git clone https://github.com/Duggineniakhil/Gold-Load-Agent.git
cd Gold-Load-Agent
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:5173>. The API runs on <http://localhost:3001>, and Vite proxies `/api` to it. `npm install` also generates the Prisma client.

- Put your key in `LLM_API_KEY` in `.env` to enable Loan Assist. Without it, the rest of the app works and the agent endpoints return `503 AGENT_NOT_CONFIGURED`.
- **Port 5432 already in use** (for example by a local PostgreSQL)? Set `POSTGRES_PORT=5433` in `.env` and change the port in `DATABASE_URL` and `TEST_DATABASE_URL` to match.
- The test database `tglobal_test` is created by `docker/postgres-init` the first time the volume starts. If you had an older volume, recreate it with `docker compose down -v`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_PORT` | `5432` | Host port for the Compose database. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/tglobal` | Development database. |
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/tglobal_test` | Test and eval database. The name must end in `_test`, or the tests refuse to run. |
| `API_PORT` | `3001` | API port. The Vite proxy expects 3001. |
| `GOLD_RATE_24K_PAISE_PER_GRAM` | `700000` | Mock 24K rate: ₹7,000 per gram. |
| `LLM_API_KEY` | empty | LLM provider key. Empty disables Loan Assist and skips the evals. |
| `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` | Any OpenAI-compatible base URL, ending in `/`. |
| `LLM_MODEL` | `gemini-3.5-flash-lite` | Model used by Loan Assist. |
| `LLM_TIMEOUT_MS` | `30000` | Per-request timeout. 408, 429, 500, 502, 503 and 504 responses are retried 3 times with backoff. |

## Tests and evals

PostgreSQL must be running (`docker compose up -d db`). Tests run the migrations against `TEST_DATABASE_URL` and clear its tables between tests.

```bash
npm test
```

There are 103 tests:

- **Maths:** spec cases 1–3, flooring, the 75% cap, and property tests.
- **Validation:** 400 errors, including spec cases 4–5.
- **Duplicates:** the 409, spec case 6, and the 7-day window.
- **Concurrency:** spec case 8, 2 and 10 parallel requests for one mobile number.
- **Idempotency:** spec case 7, key reuse, and racing retries.
- **Status workflow:** every illegal transition, and simultaneous decisions.
- **Gold-rate cache** and the error contract.
- **Masking:** mobile numbers are masked in API responses and in the rendered table.
- **Loan Assist with a scripted fake model:**
  - nothing is filed before the borrower confirms
  - tool errors go back to the model
  - invented numbers and assumed inputs are rejected
  - agent and form leads come out identical

```bash
npm run eval
```

This runs 7 conversations against the live model and the test database, checking behaviour (tools called, summaries, stored leads) rather than wording:

1. Happy path to submission
2. Missing field
3. Net weight greater than gross
4. Duplicate within 7 days
5. Off-topic request
6. Prompt injection
7. Hinglish

Without `LLM_API_KEY`, it prints "Skipped" and exits 0. Expect 15–90 seconds per conversation on the free tier.

Other checks: `npm run typecheck` and `npm run lint`. For the UI walkthrough, run `npm run screenshot --workspace=@tglobal/web` with the dev server running and `PLAYWRIGHT_BROWSERS_PATH` set to your Playwright browsers.

## API

Base path: `/api/v1`. Every error has the same shape: `{ "error": { "code", "message", "fields": [{ "field", "message" }] } }`. That includes malformed JSON, unknown routes and 500s, which never include a stack trace. Mobile numbers are always masked (`9876XXXX10`).

| Method and path | Purpose |
| --- | --- |
| `GET /loan-schemes` | Active plans |
| `POST /quotes` | Quote for every plan (no database write) |
| `POST /leads` | Validate, recompute, de-duplicate and store; optional `Idempotency-Key` header |
| `GET /leads?planId=&limit=&cursor=` | Newest first, masked, cursor pagination |
| `PATCH /leads/:applicationId/status` | Status workflow step, audited |
| `GET /leads/:applicationId/audit` | Status history |
| `GET /gold-rate` | Cached 24K rate (60 s) |
| `POST /agent/messages` | Send a message to Loan Assist |
| `POST /agent/sessions/:sessionId/confirm` | Confirm or cancel the prepared application |
| `GET /health` | Liveness check |

**Quote** (spec case 1):

```bash
curl -s -X POST localhost:3001/api/v1/quotes -H 'content-type: application/json' \
  -d '{"netWeightGrams":"45","grossWeightGrams":"50","karat":22}'
```

```json
{
  "goldRatePerGram": 7000,
  "pureGoldGrams": "41.250",
  "goldValuePaise": 28875000,
  "quotes": [
    { "planId": "PLAN_BULLET_01", "name": "Bullet Repayment", "ltvAppliedPercent": 70, "eligibleLoanPaise": 20212500 },
    { "planId": "PLAN_EMI_01", "name": "Monthly EMI", "ltvAppliedPercent": 75, "eligibleLoanPaise": 21656200 }
  ]
}
```

**Validation error** (net weight 52 g, gross 50 g) returns `400`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "fields": [{ "field": "netWeightGrams", "message": "Net weight cannot exceed gross weight." }]
  }
}
```

**Create a lead** returns `201`. Client-sent amounts are ignored; the server recomputes them.

```bash
curl -s -X POST localhost:3001/api/v1/leads -H 'content-type: application/json' \
  -H 'Idempotency-Key: 7d0c6c1e-readme-example' \
  -d '{"name":"Ravi Kumar","mobileNumber":"9876543210","grossWeightGrams":"50","netWeightGrams":"45","karat":22,"planId":"PLAN_EMI_01"}'
```

```json
{
  "applicationId": "GL-1002",
  "status": "SUBMITTED",
  "createdAt": "2026-10-22T17:03:58.733Z",
  "lead": { "applicationId": "GL-1002", "name": "Ravi Kumar", "mobileNumber": "9876XXXX10", "netWeightGrams": 45, "eligibleLoanPaise": 21656200, "status": "SUBMITTED" },
  "quote": { "goldRatePerGram": 7000, "pureGoldGrams": "41.250", "goldValuePaise": 28875000, "planId": "PLAN_EMI_01", "planName": "Monthly EMI", "ltvAppliedPercent": 75, "eligibleLoanPaise": 21656200 }
}
```

(`lead` is shortened here; the response includes every stored field.)

- Sending the same request with the same `Idempotency-Key` returns the same `201` body, with the header `Idempotency-Replayed: true`.
- The same key with a different body returns `422 IDEMPOTENCY_KEY_REUSED`.
- The same mobile number within 7 days, without that key, returns `409`:

```json
{
  "error": {
    "code": "DUPLICATE_APPLICATION",
    "message": "An application was already submitted with this mobile number in the last 7 days.",
    "fields": [],
    "existing": { "applicationId": "GL-1002", "createdAt": "2026-10-22T17:03:58.733Z" }
  }
}
```

**Status workflow:** SUBMITTED → UNDER_REVIEW → APPROVED or REJECTED.

```bash
curl -s -X PATCH localhost:3001/api/v1/leads/GL-1002/status -H 'content-type: application/json' \
  -d '{"status":"UNDER_REVIEW","actor":"Asha Rao"}'
```

```json
{
  "applicationId": "GL-1002",
  "status": "UNDER_REVIEW",
  "updatedAt": "2026-10-22T17:04:06.098Z",
  "entry": { "from": "SUBMITTED", "to": "UNDER_REVIEW", "actor": "Asha Rao", "at": "2026-10-22T17:04:06.115Z" }
}
```

An illegal move returns `409 INVALID_TRANSITION` with `"from": "UNDER_REVIEW"`, `"to": "SUBMITTED"` and `"allowed": ["APPROVED", "REJECTED"]`.

**Gold rate:**

```json
{ "ratePerGram24k": 7000, "ratePaisePerGram24k": 700000, "currency": "INR", "source": "mock", "asOf": "2026-10-22T17:03:58.270Z", "cachedUntil": "2026-10-22T17:04:58.270Z" }
```

**Loan Assist:** `POST /agent/messages` with `{"message": "I have 45 g net and 50 g gross of 22 carat gold. How much can I get?"}` returns:

```json
{
  "sessionId": "fe4a5448-5f02-4fa9-a011-f16e0b52518a",
  "reply": "Here are the details for your 22-karat gold (50 grams gross, 45 grams net):\n- Pure gold: 41.250 grams\n- Gold value: ₹2,88,750 … Monthly EMI … Eligible loan: ₹2,16,562 …",
  "toolEvents": [{ "tool": "calculate_quote", "ok": true }, { "tool": "get_loan_schemes", "ok": true }],
  "pendingConfirmation": null,
  "submission": null
}
```

(`reply` is shortened here.) Send `sessionId` with each later message. When the agent calls `submit_application`, nothing is filed: `pendingConfirmation` carries the server-computed summary. The lead is created only by `POST /agent/sessions/:sessionId/confirm` with `{"confirm": true}`, through the same service as the form.

## LLM provider

Loan Assist uses **Gemini 3.5 Flash Lite** (free tier) through Gemini's OpenAI-compatible chat-completions endpoint, called from the API only; the key never reaches the browser. The model sees three tools: `get_loan_schemes`, `calculate_quote` and `submit_application`. Tool arguments are validated with the shared Zod schemas, and the server enforces three guardrails:

- **No invented numbers.** Every number in a reply must come from a tool result, the borrower or the system prompt. Otherwise the model is asked to rewrite once, and then a fixed safe reply is used.
- **No assumed inputs.** Weights, karat and mobile number must have been typed by the borrower.
- **Confirm before filing.** Only the Confirm button files an application.

**To swap providers,** change three variables in `.env`. Any OpenAI-compatible endpoint with tool calling works:

| Provider | `LLM_BASE_URL` | `LLM_MODEL` (example) |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1/` | `gpt-4o-mini` |
| Groq | `https://api.groq.com/openai/v1/` | `llama-3.3-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1/` | `qwen2.5:7b`; set `LLM_API_KEY` to any non-empty value |

Only Gemini has been tested; the other rows are examples. Run `npm run eval` after swapping to check the new model's behaviour.

## Bonuses attempted

| Bonus | Status |
| --- | --- |
| Spec case 7: Idempotency-Key replay | Done |
| Spec case 8: parallel requests give one 201 and one 409 | Done (advisory lock) |
| Pagination on `GET /leads` | Done (cursor, "Load more") |
| **B1 Harden the backend:** concurrency-safe duplicate check, Idempotency-Key, status workflow with audit log, cached gold-rate endpoint | Done |
| **B2 Smarter agent:** prompt-injection tests and tool-status chips | Done |
| B2: `check_existing_application` tool and streamed replies | Not started |
| Agent evals: prompt injection, Hinglish and changing your mind | Done (7 live evals plus scripted tests; not 10+ live) |
| **B3 AI extras:** appraisal-slip photo extraction, plain-English admin filter | Not started |
| **B4 Ops ready** | Partial: Compose runs PostgreSQL only. No GitHub Actions, no rate limit, no ARCHITECTURE.md, no demo video. |

## Known limitations

- **The admin view has no authentication.** Anyone who can reach the API can list leads and change statuses, and the audit `actor` is a name the admin types.
- **Loan Assist conversations are kept in API memory** (30-minute idle expiry, 1,000-session cap). A restart ends open chats, and running more than one API instance would need a shared store.
- **Free-tier latency:** replies take roughly 5–20 seconds and are not streamed. Gemini sometimes returns "high demand" errors, which are retried and then shown as `503 LLM_UNAVAILABLE`.
- **Mobile numbers reach the LLM provider** when the borrower types them in the chat. They are masked in every API response and log.
- **Idempotency keys never expire,** and only successful `201` responses are stored.
- **The gold rate is a mock** (₹7,000/g from config) behind the cache; there is no live feed.
- **A missing index:** `schema.prisma` declares an index on `LoanScheme.isActive`, but no migration creates it.

## What I'd do with more time

- Add admin login with roles, so the audit actor comes from the session.
- Move Loan Assist sessions into PostgreSQL or Redis, stream replies, and add the `check_existing_application` tool.
- Run tests, lint and evals in GitHub Actions with a PostgreSQL service, and add rate limits on `POST /leads` and the agent.
- Expire idempotency keys after 24 hours, and add the missing `LoanScheme` index migration.
- Grow the live eval set past 10 conversations, with a pass threshold, so prompt or model changes are caught in CI.
