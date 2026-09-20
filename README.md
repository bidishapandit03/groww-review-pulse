# Groww Review Pulse

Weekly review intelligence for a fintech app. Every Monday the pipeline imports
the latest Google Play reviews, tags them into five themes, ranks them, and
writes a ~250-word recap note — with verbatim voices and action items — that
the team can open as an `.eml` draft in one click.

Product rules (enforced in code, never by the LLM): exactly **3 themes, 3
verbatim quotes, 3 action items** in the weekly note, **≤250 words**, and
**zero PII** (everything is redacted before any LLM call or file write; raw
reviews live in Vercel Blob and never in this public repo).

## Stack

- Next.js 16 (App Router) on Vercel, free/low-cost tooling only
- Mistral `ministral-8b-latest` for tagging and note-writing (free tier)
- `google-play-scraper` for public review data
- Vercel Blob for raw/pipeline state (OIDC-connected store; no static secrets)
- Zod-validated contracts at every boundary; Vitest + a PII gate in CI

## Theme legend

Exactly five themes (plus a hidden `other` bucket that never surfaces as a
theme in the note):

| # | Theme | What it covers |
|---|-------|----------------|
| 1 | **Onboarding & KYC** (`onboarding_kyc`) | Demat account opening, KYC / e-sign delays, document uploads, verification rejections |
| 2 | **Payments & Withdrawals** (`payments_withdrawals`) | UPI add-funds failures, bank account linking, payout delays, SIP autopay issues |
| 3 | **Trading & Order Execution** (`trading_orders`) | Order placement failures, lag during market hours, F&O, charts, price data |
| 4 | **Charges, Statements & Reports** (`charges_statements`) | Brokerage / charges complaints, P&L and tax statements, contract notes |
| 5 | **App Performance & Support** (`app_support`) | Crashes, login / OTP issues, slowness, in-app help and support response |
| — | `other` | Anything that fits none of the above — counted in aggregates, never chosen as a top theme in the note |

## Re-run for a new week

The pipeline is `import → redact → tag → aggregate → note → email`. Three ways
to trigger it:

**1. On the live site (recommended)**

Open the deployed page → **Run pipeline** section → **Run weekly pipeline now**.
The page then shows the freshly-generated recap. If a previous run is stuck
(rare — Vercel's 60s function cap can kill a run mid-tagging), a **Reset stuck
run** button appears; runs older than 10 minutes are also auto-recovered.

> If `ADMIN_PASSWORD` is set in the environment, the button asks for it
> (`x-admin-password` header); otherwise it's open in dev.

**2. Automatically**

`vercel.json` schedules a Monday-09:00 cron to `GET /api/cron/pulse`.

**3. Locally (one-shot)**

```bash
npm run pipeline
```

Runs the same orchestrator (`lib/pipeline/run.ts`) against the default store.
With `.env.local` pointing at your Blob store you run against prod data; without
a token it uses gitignored local JSON under `data/raw/`.

### What happens on each run

- Only **new** reviews are fetched and tagged (dedup by id against the corpus).
- Tagging is bounded to **200 fresh reviews per run** so it fits inside Vercel
  Hobby's 60s ceiling — a first-run backlog catches up over successive runs, and
  a fresh checkout has none.
- The 8-week window is then aggregated: theme counts, week-over-week deltas, and
  verbatim quote candidates; the LLM only writes the 3-theme/3-quote/3-action
  note, while every exact number (counts, WoW, word count, quote text) is
  recomputed in code.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without a completed run it
renders committed demo artifacts (`outputs/weekly-note-sample.*` + sample tagged
reviews) so you see real content immediately.

Optional env vars are documented in [`.env.example`](.env.example) (copy to
`.env.local`, never commit it).

```bash
npm test          # Vitest (redaction + validation tests are a CI gate)
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm run pii:gate  # scans data/sample + outputs for PII leaks
npm run pipeline  # one-shot pipeline run (local)
```