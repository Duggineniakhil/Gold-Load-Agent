# TGlobal Gold Loan Portal

TypeScript monorepo for the TGlobal gold-loan portal assignment. It contains an Express API, a Vite/React web app, shared TypeScript exports, and a PostgreSQL database managed with Prisma.

## Local setup

Requirements: Node.js 20 or newer and Docker Compose.

```sh
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:5173>. The Vite development server proxies `/api` requests to the API on port 3001. The health endpoint is `GET /api/v1/health`.

Copy `.env.example` to `.env` to customize local settings. Defaults target the PostgreSQL databases created by Compose: `tglobal` for development and `tglobal_test` for tests. The test database is created by the init script on the first startup of a fresh PostgreSQL volume.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_PORT` | `5432` | Host port for the Compose database. If another PostgreSQL already uses 5432, set e.g. `5433` and change the two URLs below to match. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/tglobal` | Development database. |
| `TEST_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/tglobal_test` | Test and eval database; its name must end in `_test`. |
| `API_PORT` | `3001` | API port (the Vite proxy targets 3001). |
| `GOLD_RATE_24K_PAISE_PER_GRAM` | `700000` | Mock 24K rate: ₹7,000 per gram. |
| `LLM_API_KEY` | empty | Gemini API key. Without it the app runs, Loan Assist answers 503 `AGENT_NOT_CONFIGURED`, and `npm run eval` is skipped. |
| `LLM_BASE_URL` | Gemini's OpenAI-compatible endpoint | Any OpenAI-compatible chat-completions endpoint works. |
| `LLM_MODEL` | `gemini-3.5-flash-lite` | Model used by Loan Assist. |
| `LLM_TIMEOUT_MS` | `30000` | Per-request timeout; overloaded (429/5xx) responses are retried 3 times with backoff. |

## API foundation

The Express app is created with `createApp(deps)` so repositories and the gold rate can be injected in tests. It assigns a request ID, uses pino-http logging with sensitive fields redacted, limits JSON request bodies, and returns one JSON error shape for validation failures, malformed JSON, unknown routes, and unexpected errors.

Shared Zod schemas in `packages/shared/src/schemas.ts` validate Unicode names, Indian mobile numbers, weights in grams (up to three decimal places), and karat values. The API and web workspace can import these from `@tglobal/shared`.

- `GET /api/v1/loan-schemes` returns active schemes with interest and LTV percentages.
- `POST /api/v1/quotes` accepts `netWeightGrams`, `grossWeightGrams`, and `karat`; it writes no data and returns the configured gold rate, pure-gold weight, gold value in paise, and eligible loan amounts for each active scheme.
- `POST /api/v1/leads` validates, recomputes the quote, rejects a repeat mobile within 7 days with 409 and the existing application ID, and stores the lead.
- `GET /api/v1/leads` lists leads newest first with masked mobiles, a plan filter and cursor pagination.
- `POST /api/v1/agent/messages` and `POST /api/v1/agent/sessions/:sessionId/confirm` drive Loan Assist (below).

API Supertest coverage includes the seeded schemes, assignment quote examples, request validation, malformed JSON, unknown routes, and generic internal errors. Lead tests cover the server-side recalculation, 400/404/409 cases, the 7-day window and concurrent duplicate submissions.

## Web app

`apps/web` is a React + Vite single-page app with three routes:

- `/` explains how offers work. Every figure on it (rate, plan terms, the 45 g · 22K worked example) is fetched from the API, not hard-coded.
- `/apply` is the three-step application: details with inline validation as you type (the shared Zod schemas), a live quote re-requested about 300 ms after typing stops with selectable plan cards, then review and submit. A 409 shows "You already applied on 3 Oct, application GL-1042."; API field errors return the user to the right step.
- `/leads` is the lead register: newest first, masked mobiles, filter by plan, stacked cards on phones.

`npm run screenshot --workspace=@tglobal/web` (with the dev server running and `PLAYWRIGHT_BROWSERS_PATH` pointing at your Playwright browsers) walks every page and the full application flow, including the 409 path, at 375 px and 1440 px against a mocked API, fails on horizontal overflow and saves screenshots to `apps/web/artifacts/design-system`.

## Loan Assist (AI agent)

The chat panel ("Ask Loan Assist") talks only to the API; the LLM key never reaches the browser. The agent uses Gemini through its OpenAI-compatible chat-completions endpoint with plain `fetch`, so no SDK dependency is needed.

- **Tools** (`apps/api/src/agent/tools.ts`): `get_loan_schemes`, `calculate_quote` and `submit_application` call the same service functions as the REST routes. Arguments are validated with the shared Zod schemas (`quoteRequestSchema`, `leadRequestSchema`); validation errors go back to the model as `{ error: { code, fields } }` so it can ask the borrower to fix them. Tool results carry formatted rupee strings so the model never converts paise.
- **Confirmation**: `submit_application` never files anything. It returns a server-computed summary that the UI shows as a card; only the Confirm button (`/confirm`) calls `submitLead`, which recomputes the quote and applies the 7-day duplicate check exactly like the form. The confirmation reply is written by the server, so the application ID and loan amount shown are the stored ones.
- **No invented numbers**: every number in a model reply must appear in a tool result, the borrower's messages or the system prompt. Otherwise the model is asked to rewrite once, and a fixed safe reply is used if it still fails (`apps/api/src/agent/number-guard.ts`).
- **No assumed inputs**: weights, karat and mobile number in tool arguments must have been typed by the borrower, and each typed number can back only one field, so a single "45 grams" cannot become both net and gross weight.
- **Guardrails** live in the system prompt (`apps/api/src/agent/prompt.ts`): gold loans only, no investment advice, no approval promises, instructions in user messages are ignored.
- **Privacy**: agent logs record the session ID, tool names and outcomes only; responses and summaries show masked mobiles.
- **Sessions** are kept in API memory (30-minute idle expiry, 1,000-session cap). A restart ends open conversations; the UI then offers a new one.

### Evals

`npm run eval` runs seven scripted conversations against the live model and the test database, checking behaviour rather than wording:

1. Happy path through to submission (quote ₹2,16,562 on EMI, confirmed, stored as 21656200 paise)
2. Missing gross weight: the agent asks instead of guessing
3. Net weight greater than gross: no quote, the problem is explained
4. Duplicate within 7 days: reported with the existing application ID, no second lead
5. Off-topic request: no tools called, steers back to gold loans
6. Bonus: prompt injection cannot file or approve without the Confirm button
7. Bonus: Hinglish request quoted through the tool (₹96,250 on EMI)

The agent's control flow (confirmation gating, tool error feedback, the number check, failed-turn rollback, form/agent parity) is also covered deterministically in `apps/api/test/agent.test.ts` with a scripted fake model.

## Database

Prisma schema and migrations are in `apps/api/prisma`. `npm run db:migrate` applies pending migrations and `npm run db:seed` idempotently upserts the Bullet Repayment and Monthly EMI schemes.

The migration stores loan scheme rates as basis points, creates the Lead table with integer milligram weights and integer paise `BigInt` amounts, and enforces the required weight, karat, and LTV checks in PostgreSQL. Application IDs are generated by a PostgreSQL sequence beginning at `GL-1001`.

The API database test helper runs migrations against `TEST_DATABASE_URL`, then truncates test tables and resets the application ID sequence between tests. It refuses to use a database whose name does not end in `_test`.

## Exact money calculations

`apps/api/src/domain/money.ts` contains pure functions with no Express or Prisma dependencies. Weights are parsed from decimal strings into integer milligrams, gold values use integer paise arithmetic, and eligible loans are floored from the exact weight and karat fraction without intermediate value rounding. Display-only pure-gold grams use three decimal places with half-up rounding. `formatINR` formats whole-rupee values with Indian digit grouping.

The money tests cover parsing edge cases, the assignment's EMI and Bullet examples, fractional-karat flooring, LTV capping, and fast-check properties for whole-rupee loans, the 75% limit, and monotonicity by weight.

## Workspace commands

- `npm run dev` starts the API and web development servers together.
- `npm test` runs tests in all workspaces; database tests require PostgreSQL to be running.
- `npm run typecheck` checks TypeScript in each workspace.
- `npm run lint` runs ESLint.
- `npm run eval` runs the Loan Assist conversation evals against the configured LLM (skipped when `LLM_API_KEY` is empty).
- `npm run db:migrate` applies Prisma migrations.
- `npm run db:seed` seeds the loan schemes.
