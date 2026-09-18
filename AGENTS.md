<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Groww Review Pulse — project constraints

Read these before editing anything. They encode the PRD as hard rules.

## Product rules (non-negotiable)
- Exactly **5 themes** in the legend (plus a hidden `other` bucket that never surfaces in the note).
- The weekly note must contain **exactly 3 themes, 3 verbatim quotes, 3 action ideas** and be **≤250 words**.
- **No PII ever**: usernames, emails, phone numbers, IDs, PAN, UPI IDs, URLs, 12+ digit runs. Redact before any LLM call or file write. Reviewers/user-identifying fields are never stored.
- Anything that must be exact (counts, averages, week-over-week change, word count, quote text) is computed **in code, never by the LLM**.
- Raw reviews never get committed to git (public repo). Raw data lives in Vercel Blob; locally in `data/raw/` (gitignored).
- Free/low-cost tooling, public data sources only. No scraping behind logins.

## Engineering conventions
- Pipeline steps are independent functions in `lib/`, called by `app/api/pipeline/[step]/route.ts` and orchestrated by `app/api/cron/pulse/route.ts`.
- State persists through `lib/state.ts` (Vercel Blob in prod, local JSON in dev).
- All external contracts validated with `zod`. All prompt text lives in `prompts/*.txt`.
- Tests live in `tests/`, run with Vitest (`npm test`). The redaction + validation tests are a CI gate.
- Secrets only in Vercel env / `.env.local`; `.env.example` documents names, never real values.
