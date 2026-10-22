# TGlobal Gold Loan Portal

A gold-loan intake portal for field agents and borrowers. Enter the gold's weight and karat to get a preliminary offer for every plan, then apply through a 3-step form or by chatting with **Loan Assist**, an AI agent that quotes and files applications by calling the backend's tools. Both paths use the same validated service layer and produce identical numbers. A public calculator estimates the loan and its repayment, and a passcode-protected admin page shows totals and every application, with a status workflow and an audit trail.

How it fits together is in [ARCHITECTURE.md](ARCHITECTURE.md). AI tools, exact prompts and the AI mistakes that were caught are in [AI_LOG.md](AI_LOG.md).

## Tech choices and why

| Choice                                                                        | Why                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm workspaces: `apps/api`, `apps/web`, `packages/shared`                     | One install. The shared package holds the Zod schemas, so the API, the form and the agent tools validate with exactly the same rules.                                      |
| Node 20 + Express 5 + TypeScript                                              | Express 5 forwards async errors to the error handler, so every failure returns the same JSON error shape.                                                                  |
| Zod                                                                           | Request validation and inferred types from one definition. Field errors map directly to `fields[]`.                                                                        |
| PostgreSQL + Prisma                                                           | Migrations and a typed client. Money and weights are integers (paise as `BIGINT`, milligrams as `INT`), and `CHECK` constraints back up the rules in the database.         |
| Integer maths with `BigInt`                                                   | No floats anywhere. The loan is `floor(goldValue × min(maxLtv, 75%))` in whole rupees, computed from the exact `karat/24` fraction, never from a rounded pure-gold figure. |
| PostgreSQL advisory locks                                                     | The 7-day duplicate check and the idempotency check hold under concurrent requests without a uniqueness trick.                                                             |
| React + Vite + `motion`                                                       | A fast single-page app. The UI calls the API for every figure and never computes money itself.                                                                             |
| Vitest + Supertest + Playwright                                               | Unit, API and database tests in one runner, plus a Playwright walkthrough at 375, 768 and 1440 px.                                                                         |
| Gemini, with Groq as a fallback, via OpenAI-compatible APIs and plain `fetch` | Free tiers with tool calling. If Gemini is busy, Groq answers instead, and there is no SDK lock-in: any OpenAI-compatible provider works by changing env vars.             |

## Prerequisites

- Node.js 20 or newer (npm 10)
- Docker with Compose, for PostgreSQL 16
- Optional: a Gemini API key (and optionally a Groq key as fallback), for Loan Assist, slip extraction and the live evals

## Setup

### Run the full app with Docker Compose

From a fresh clone, optionally copy `.env.example` to `.env` and add an LLM key for Loan Assist:

```bash
docker compose up --build
```

Compose starts PostgreSQL, applies migrations and seeds plans before starting the API, then serves the web app through Nginx. Open <http://localhost:5173>; the API health endpoint is <http://localhost:3001/api/v1/health>. The API and database ports can be changed with `API_PORT` and `POSTGRES_PORT`; the web port can be changed with `WEB_PORT`. Loan Assist and appraisal-slip extraction need a server-side `LLM_API_KEY` (or fallback key); the rest of the app works without one.

Stop the containers with `docker compose down`. Database data persists in the `postgres_data` volume.

### Local development

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

The pages are `/` (home), `/apply` (3-step application), `/calculator` (loan and repayment estimate) and `/admin` (totals, the lead register and status changes; `/leads` redirects there).

- Put your key in `LLM_API_KEY` in `.env` to enable Loan Assist. Without it, the rest of the app works and the agent endpoints return `503 AGENT_NOT_CONFIGURED`.
- **Port 5432 already in use** (for example by a local PostgreSQL)? Set `POSTGRES_PORT=5433` in `.env` and change the port in `DATABASE_URL` and `TEST_DATABASE_URL` to match.
- The test database `tglobal_test` is created by `docker/postgres-init` the first time the volume starts. If you had an older volume, recreate it with `docker compose down -v`.

## Environment variables

| Variable                       | Default                                                      | Purpose                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_PORT`                | `5432`                                                       | Host port for the Compose database.                                                                                            |
| `DATABASE_URL`                 | `postgresql://postgres:postgres@localhost:5432/tglobal`      | Development database.                                                                                                          |
| `TEST_DATABASE_URL`            | `postgresql://postgres:postgres@localhost:5432/tglobal_test` | Test and eval database. The name must end in `_test`, or the tests refuse to run.                                              |
| `API_PORT`                     | `3001`                                                       | API port. The Vite proxy expects 3001.                                                                                         |
| `WEB_PORT`                     | `5173`                                                       | Host port for the Compose web app.                                                                                             |
| `GOLD_RATE_24K_PAISE_PER_GRAM` | `700000`                                                     | Mock 24K rate: ₹7,000 per gram.                                                                                                |
| `LLM_API_KEY`                  | empty                                                        | LLM provider key. Empty disables Loan Assist and skips the evals.                                                              |
| `LLM_BASE_URL`                 | `https://generativelanguage.googleapis.com/v1beta/openai/`   | Any OpenAI-compatible base URL, ending in `/`.                                                                                 |
| `LLM_MODEL`                    | `gemini-3.5-flash-lite`                                      | Model used by Loan Assist.                                                                                                     |
| `LLM_TIMEOUT_MS`               | `30000`                                                      | Per-request timeout. 408, 429, 500, 502, 503 and 504 responses are retried 3 times with backoff (once when a fallback is set). |
| `LLM_FALLBACK_API_KEY`         | empty                                                        | Optional fallback provider key, used only when the primary is unavailable. On its own, it also enables Loan Assist.            |
| `LLM_FALLBACK_BASE_URL`        | `https://api.groq.com/openai/v1/`                            | Fallback OpenAI-compatible base URL.                                                                                           |
| `LLM_FALLBACK_MODEL`           | `openai/gpt-oss-20b`                                         | Fallback model.                                                                                                                |
| `RATE_LIMIT_LEADS_PER_MINUTE`  | `20`                                                         | Per-IP limit on `POST /leads`; `0` turns it off.                                                                               |
| `RATE_LIMIT_AGENT_PER_MINUTE`  | `30`                                                         | Per-IP limit on the Loan Assist endpoints; `0` turns it off.                                                                   |
| `ADMIN_PASSCODE`               | empty                                                        | When set, the admin page and admin endpoints require it (sent as `X-Admin-Passcode`). Empty leaves them open for local use.    |

## Tests and evals

PostgreSQL must be running (`docker compose up -d db`). Tests run the migrations against `TEST_DATABASE_URL` and clear its tables between tests.

```bash
npm test
```

There are 141 tests:

- **Maths:** spec cases 1–3, flooring, the 75% cap, and property tests.
- **Validation:** 400 errors, including spec cases 4–5.
- **Duplicates:** the 409, spec case 6, and the 7-day window.
- **Concurrency:** spec case 8, 2 and 10 parallel requests for one mobile number.
- **Idempotency:** spec case 7, key reuse, and racing retries.
- **Status workflow:** every illegal transition, and simultaneous decisions.
- **Gold-rate cache**, the rate limits and the error contract.
- **Boundaries:** net equal to gross, the 1000 g limit, mobile first digits, and name length.
- **Calculator repayment:** the textbook EMI (₹1,00,000 at 12% for 12 months is ₹8,884.88), bullet interest, and a property test against an independent calculation.
- **Admin passcode:** every admin endpoint returns 401 without it, wrong guesses are rate-limited, and the stats total every lead.
- **Masking:** mobile numbers are masked in API responses and in the rendered table.
- **Loan Assist with a scripted fake model:**
  - nothing is filed before the borrower confirms
  - tool errors go back to the model
  - invented numbers and assumed inputs are rejected
  - agent and form leads come out identical
  - `check_existing_application` only checks a number the borrower typed
  - the Groq fallback takes over only when Gemini is unavailable

```bash
npm run eval
```

This runs 10 conversations against the live model and the test database, checking behaviour (tools called, summaries, stored leads) rather than wording:

1. Happy path to submission
2. Missing field
3. Net weight greater than gross
4. Duplicate within 7 days
5. Off-topic request
6. Prompt injection
7. Hinglish
8. Cancelled application is never filed
9. Asks for purity before quoting when it is missing
10. Checks for a recent application without filing a new one

Without an LLM key, it prints "Skipped" and exits 0. Expect 15–90 seconds per conversation on the free tier.

Other checks: `npm run typecheck` and `npm run lint`. GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs install, typecheck, lint and all tests against its own PostgreSQL on every push and pull request. For the UI walkthrough, run `npm run screenshot --workspace=@tglobal/web` with the dev server running and `PLAYWRIGHT_BROWSERS_PATH` set to your Playwright browsers.

## API

Base path: `/api/v1`. Every error has the same shape: `{ "error": { "code", "message", "fields": [{ "field", "message" }] } }`. That includes malformed JSON, unknown routes, rate limits (`429 RATE_LIMITED` with `Retry-After`) and 500s, which never include a stack trace. Mobile numbers are always masked (`9876XXXX10`).

The chat uses `POST /agent/messages/stream`, which sends the reply as Server-Sent Events (`start`, `delta` chunks, then `done` with the full turn, or `error` in the usual error shape). The reply is streamed only after it has passed the number check, so unverified text never reaches the borrower. `POST /appraisal-slip/extract` takes an image data URL and asks the server-side LLM to read gross weight, net weight and karat from the slip. It returns only values printed on the slip (or `null`), validated with the shared schemas, and the borrower reviews them in the form before anything is quoted.

| Method and path                             | Purpose                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /loan-schemes`                         | Active plans                                                                      |
| `POST /quotes`                              | Quote for every plan (no database write)                                          |
| `POST /leads`                               | Validate, recompute, de-duplicate and store; optional `Idempotency-Key` header    |
| `POST /repayment-estimates`                 | Calculator: EMI or bullet repayment for a loan amount on a plan, in exact paise   |
| `GET /leads?planId=&filter=&limit=&cursor=` | Admin: newest first, masked, cursor pagination; `filter` is plain English (below) |
| `GET /leads/stats?planId=`                  | Admin: count per status and total eligible loans                                  |
| `PATCH /leads/:applicationId/status`        | Admin: status workflow step, audited                                              |
| `GET /leads/:applicationId/audit`           | Admin: status history                                                             |
| `GET /gold-rate`                            | Cached 24K rate (60 s)                                                            |
| `POST /agent/messages`                      | Send a message to Loan Assist                                                     |
| `POST /agent/messages/stream`               | The same, with the reply streamed as Server-Sent Events                           |
| `POST /appraisal-slip/extract`              | Read weights and karat from an appraisal-slip photo (needs an LLM key)            |
| `POST /agent/sessions/:sessionId/confirm`   | Confirm or cancel the prepared application                                        |
| `GET /health`                               | Liveness check                                                                    |

**Plain-English admin filter.** `filter` accepts phrases such as `approved EMI 22K over 40 g`. A rule-based parser (no LLM, no SQL built from text) understands status words (pending/new/submitted, under review, approved, rejected), `EMI` or `bullet`, `18K`/`22K`/`24K` and net-weight thresholds (`over`, `above`, `at least` … grams), and the response's `filterSummary` says how the text was read.

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
    {
      "planId": "PLAN_BULLET_01",
      "name": "Bullet Repayment",
      "ltvAppliedPercent": 70,
      "eligibleLoanPaise": 20212500
    },
    {
      "planId": "PLAN_EMI_01",
      "name": "Monthly EMI",
      "ltvAppliedPercent": 75,
      "eligibleLoanPaise": 21656200
    }
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
  "lead": {
    "applicationId": "GL-1002",
    "name": "Ravi Kumar",
    "mobileNumber": "9876XXXX10",
    "netWeightGrams": 45,
    "eligibleLoanPaise": 21656200,
    "status": "SUBMITTED"
  },
  "quote": {
    "goldRatePerGram": 7000,
    "pureGoldGrams": "41.250",
    "goldValuePaise": 28875000,
    "planId": "PLAN_EMI_01",
    "planName": "Monthly EMI",
    "ltvAppliedPercent": 75,
    "eligibleLoanPaise": 21656200
  }
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
  "entry": {
    "from": "SUBMITTED",
    "to": "UNDER_REVIEW",
    "actor": "Asha Rao",
    "at": "2026-10-22T17:04:06.115Z"
  }
}
```

An illegal move returns `409 INVALID_TRANSITION` with `"from": "UNDER_REVIEW"`, `"to": "SUBMITTED"` and `"allowed": ["APPROVED", "REJECTED"]`.

**Gold rate:**

```json
{
  "ratePerGram24k": 7000,
  "ratePaisePerGram24k": 700000,
  "currency": "INR",
  "source": "mock",
  "asOf": "2026-10-22T17:03:58.270Z",
  "cachedUntil": "2026-10-22T17:04:58.270Z"
}
```

**Loan Assist:** `POST /agent/messages` with `{"message": "I have 45 g net and 50 g gross of 22 carat gold. How much can I get?"}` returns:

```json
{
  "sessionId": "fe4a5448-5f02-4fa9-a011-f16e0b52518a",
  "reply": "Here are the details for your 22-karat gold (50 grams gross, 45 grams net):\n- Pure gold: 41.250 grams\n- Gold value: ₹2,88,750 … Monthly EMI … Eligible loan: ₹2,16,562 …",
  "toolEvents": [
    { "tool": "calculate_quote", "ok": true },
    { "tool": "get_loan_schemes", "ok": true }
  ],
  "pendingConfirmation": null,
  "submission": null
}
```

(`reply` is shortened here.) Send `sessionId` with each later message. When the agent calls `submit_application`, nothing is filed: `pendingConfirmation` carries the server-computed summary. The lead is created only by `POST /agent/sessions/:sessionId/confirm` with `{"confirm": true}`, through the same service as the form.

## LLM provider

Loan Assist uses **Gemini 3.5 Flash Lite** (free tier), with **Groq `openai/gpt-oss-20b`** as a fallback when Gemini is unavailable. Both are called from the API only, through OpenAI-compatible chat-completions endpoints, so the keys never reach the browser. The model sees four tools: `get_loan_schemes`, `calculate_quote`, `check_existing_application` and `submit_application`. Tool arguments are validated with the shared Zod schemas, and the server enforces three guardrails:

- **No invented numbers.** Every number in a reply must come from a tool result, the borrower or the system prompt. Otherwise the model is asked to rewrite once, and then a fixed safe reply is used.
- **No assumed inputs.** Weights, karat and mobile number must have been typed by the borrower.
- **Confirm before filing.** Only the Confirm button files an application.

**To swap providers,** change `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` (or the `LLM_FALLBACK_*` set) in `.env`. Any OpenAI-compatible endpoint with tool calling works:

| Provider       | `LLM_BASE_URL`                    | `LLM_MODEL` (example)                                  |
| -------------- | --------------------------------- | ------------------------------------------------------ |
| OpenAI         | `https://api.openai.com/v1/`      | `gpt-4o-mini`                                          |
| Groq           | `https://api.groq.com/openai/v1/` | `openai/gpt-oss-20b`                                   |
| Ollama (local) | `http://localhost:11434/v1/`      | `qwen2.5:7b`; set `LLM_API_KEY` to any non-empty value |

Gemini and Groq have been tested; the other rows are examples. Run `npm run eval` after swapping to check the new model's behaviour.

## Bonuses attempted

| Bonus                                                                                                                                                 | Status                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Spec case 7: Idempotency-Key replay                                                                                                                   | Done                                                          |
| Spec case 8: parallel requests give one 201 and one 409                                                                                               | Done (advisory lock)                                          |
| Pagination on `GET /leads`                                                                                                                            | Done (cursor, "Load more")                                    |
| **B1 Harden the backend:** concurrency-safe duplicate check, Idempotency-Key, status workflow with audit log, cached gold-rate endpoint               | Done                                                          |
| **B2 Smarter agent:** 4th tool `check_existing_application`, prompt-injection tests, tool-status chips, streamed replies                              | Done (replies stream after the number check, see limitations) |
| Agent evals: prompt injection, Hinglish, changing your mind, 10+ automated evals                                                                      | Done (10 live evals plus scripted tests)                      |
| **B3 AI extras:** appraisal-slip photo extraction, plain-English admin filter                                                                         | Done (slip extraction not yet tried on real slip photos)      |
| **B4 Ops ready:** `docker compose up` for the whole app, GitHub Actions CI, rate limits on `/leads` and the agent, [ARCHITECTURE.md](ARCHITECTURE.md) | Done                                                          |
| B4: 2-minute demo video                                                                                                                               | Not done                                                      |

## Known limitations

- **Admin access is one shared passcode** (`ADMIN_PASSCODE`), not individual logins, and it is off when unset. It is checked on the server in constant time, with 10 wrong tries per IP per 15 minutes. The audit `actor` is a name the admin types.
- **Loan Assist conversations are kept in API memory** (30-minute idle expiry, 1,000-session cap). A restart ends open chats, and running more than one API instance would need a shared store.
- **Free-tier latency:** replies take roughly 5–20 seconds. Gemini sometimes returns "high demand" errors; Groq then answers instead, and only if both fail does the user see `503 LLM_UNAVAILABLE`.
- **Streaming starts after the reply is complete.** The server waits for the full, number-checked reply and then streams it in chunks, so the first words do not arrive sooner; the trade-off keeps unverified figures from ever being shown.
- **Rate limits behind the Docker proxy:** Express is not configured to trust Nginx's `X-Forwarded-For`, so under `docker compose up` every request appears to come from the Nginx container and all users share one per-IP limit (including the admin passcode lockout). Local `npm run dev` is not affected. The fix is a `trust proxy` setting enabled only in Docker.
- **Appraisal-slip extraction** depends on the model reading images: it has been tested with a scripted model, not yet with real slip photos, and the Groq fallback model cannot read images.
- **Mobile numbers reach the LLM provider** when the borrower types them in the chat. They are masked in every API response and log.
- **Idempotency keys never expire,** and only successful `201` responses are stored.
- **Rate-limit counters are in memory and per IP,** like the chat sessions, so they reset on restart and assume a single API instance.
- **The gold rate is a mock** (₹7,000/g from config) behind the cache; there is no live feed.
- **A missing index:** `schema.prisma` declares an index on `LoanScheme.isActive`, but no migration creates it.

## What I'd do with more time

- Replace the shared admin passcode with individual logins and roles, so the audit actor comes from the session.
- Move Loan Assist sessions and rate-limit counters into Redis, and trust the Docker proxy so per-IP limits work behind Nginx.
- Stream tokens as the model writes them, checking figures as they arrive, and record a demo video.
- Try slip extraction on real appraisal-slip photos and add an image-capable fallback model.
- Expire idempotency keys after 24 hours, and add the missing `LoanScheme` index migration.
- Grow the live eval set past 10 conversations, with a pass threshold, so prompt or model changes are caught in CI.
