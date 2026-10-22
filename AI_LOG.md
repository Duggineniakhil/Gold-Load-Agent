# AI log

## Tools used, and for what

| Tool | Used for |
| --- | --- |
| **OpenAI Codex** | The first commits: monorepo scaffold (`ebd7cdb`), Prisma schema and migrations (`dad1e91`), exact money maths in integer paise (`7236199`), API foundation and quote endpoints (`15da5b0`), lead submission and listing (`2bacfbe`), and the first design system (`e1096b1`). |
| **Claude Code** (Claude Opus 5.5) | Everything from `3ab71b1` on: fixing the failing tests and type errors, the Loan Assist agent and its evals (`8ad4d71`), the redesign and 3-step application (`68dd568`), the lead register (`2f71ca0`) and the B1 hardening (`d5dc2ce`). I worked plan first: Claude Code proposed files, approach and risks; I approved or changed the plan; then it implemented, ran typecheck, lint, tests and Playwright, and I reviewed the diffs before each commit. |
| **Gemini 3.5 Flash Lite**, with **Groq `openai/gpt-oss-20b`** as fallback (free tiers, OpenAI-compatible endpoints) | Not coding tools: the models that run inside Loan Assist. They only ever see the four tools; all maths happens in the API. |

## Prompt 1: validation (exact)

> Fix the failing name-schema test and the Prisma install, get all tests green, then plan Part B (the AI agent).

What came of it: the shared name schema was `/^[\p{L} ]+$/u`, which rejects Indian names written in Devanagari ("कुमार"), because vowel signs are Unicode *marks* (`\p{M}`), not letters. The fix allows marks inside words, requires every word to start with a letter, and NFC-normalises names first, so a decomposed "É" is accepted too. Tests now cover a Devanagari name, a decomposed accent, digits, and a string made only of vowel signs ([`packages/shared/test/schemas.test.ts`](packages/shared/test/schemas.test.ts)). A later change replaced Zod's raw messages ("Too small: expected string…") with plain ones ("Enter the full name."), so the API's 400 `fields[]` and the form's inline errors read the same.

## Prompt 2: agent tools (exact)

> Plan approved. Commit the current fixes first, then implement Part B. You can copy the Gemini key from CLAUDE.md into .env as LLM_API_KEY.

The plan it approved (written by Claude Code, summarised): three tools in `apps/api/src/agent/tools.ts` that call the same service functions as the REST routes, with arguments validated by the shared Zod schemas and validation errors handed back to the model; `submit_application` only prepares a server-computed summary, and the lead is filed by a separate Confirm endpoint; a check that every number in a reply came from a tool, the borrower or the system prompt; Vitest tests with a scripted fake model; and `npm run eval` against the live model, skipped when no key is set.

## Where the AI got it wrong

### The mistake

Testing Loan Assist by hand with the assignment's own example, *"I have 45 grams of 22 carat jewellery, how much can I get?"*, the agent answered with a full quote. The figures were correct for 45 g, but the borrower never gave a gross weight: **Gemini filled one in itself** so that `calculate_quote` would accept the call. (It also answered in Hinglish to an English message.) A prompt rule alone would not reliably stop this.

Claude Code's first fix was itself wrong. It checked that every number in the tool arguments appeared somewhere in what the borrower typed, using a set of typed numbers. That looks right, but the borrower *did* type "45", so a gross weight of 45 counted as "typed": the exact case the fix was for still got through. The same change also merged a spaced mobile number with the next number: stripping spaces turned `98765 00011, 45` into one long grouped number.

### How it was spotted

Not by reading the code: the new test written for this case failed. `refuses tool arguments the borrower never stated, such as an assumed gross weight` expected a `NOT_PROVIDED_BY_BORROWER` error and got a successful quote. Four other agent tests that use a spaced mobile number failed at the same time, which exposed the second bug.

### The fix

`ungroundedFields` in [`apps/api/src/agent/tools.ts`](apps/api/src/agent/tools.ts) now counts occurrences: each number the borrower typed can back only one field, so one "45" cannot be both the net and the gross weight. Digit groups are joined only for the mobile-number check, and only between digits. When a value was not stated, the tool returns an error telling the model to ask, and the model asks.

### The tests that now catch it

- [`apps/api/test/agent.test.ts`](apps/api/test/agent.test.ts): `refuses tool arguments the borrower never stated, such as an assumed gross weight` (scripted model reuses 45 g as gross; the tool must refuse and the reply must ask for the gross weight).
- [`apps/api/test/agent-units.test.ts`](apps/api/test/agent-units.test.ts): `borrower grounding of tool arguments` (a spaced mobile is accepted; a reused or invented weight and an untyped mobile are flagged; "net 45 g, gross 45 g" is accepted because 45 was typed twice).
- [`apps/api/eval/run.ts`](apps/api/eval/run.ts): live conversation `2. Missing field: asks instead of guessing` (no successful quote, and the reply asks for the missing weight).

## Other AI mistakes caught along the way

- **A false "all green".** Claude Code reported that typecheck passed when the API had three type errors; a `tail` on the output had cut off the API workspace. It was caught on the next full run, and the `scripts/` folder is now typechecked too.
- **A wrong diagnosis.** It first called the Prisma install "broken". The real cause was `require.resolve('prisma')` pointing at a file the published package does not ship, confirmed with `npm pack --dry-run`. This also broke `npm run db:migrate`, not just the tests.
- **An SVG path bug** in the hero's loan-to-value gauge (arc flags glued onto the x coordinate), spotted in a Playwright screenshot, not in code review.
- **Clipped columns at 768 px.** The lead register's last column was cut off inside its card. The page-level overflow check could not see it, so the Playwright walkthrough now also checks that the table fits inside its card.
- **A wrong test assumption.** A Playwright check treated a 1 px clipped table header as "visible" on phones; it now checks the rows' computed `display` instead.
