# Mikud Mortgages — Engineering Guide

This is a React/Vite application hosted on Cloudflare Pages. Supabase provides Postgres, Auth, private document storage, and Edge Functions.

## Architecture

- Frontend: `src/`, built with Vite.
- Frontend API adapter: `src/api/appClient.js` and `src/api/refinanceLeads.js`.
- Auth: Supabase magic links; administrator access requires `profiles.role = 'admin'`.
- Database migrations: `supabase/migrations/`.
- Server functions: `supabase/functions/`.
- Private refinance uploads: `documents` Storage bucket via the `document-upload` function.
- Hosting: Cloudflare Pages project `baduk-ai`, on the `office@mikud4me.co.il` Cloudflare account.
- Production site: `https://baduk-ai.co.il` (DNS zone lives in the same Cloudflare account as the Pages project and the custom domain is attached). The project's own `*.pages.dev` alias is `https://baduk-ai-a2y.pages.dev` — not `baduk-ai.pages.dev`, because that subdomain is already claimed by an unrelated Cloudflare account and Cloudflare assigned a suffixed alias instead. `pages_build_output_dir`/project name in `wrangler.toml` are unaffected by this.

There is no Base44 runtime, SDK, plugin, configuration, or server code in this repository.

## Local development

Create an ignored `.env.local` file:

```text
VITE_SUPABASE_URL=https://nkihunpgionvbgbslmfa.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Only these public browser values belong in `.env.local`. Never put Gemini, Resend, CardCom, a Supabase secret key, or a database password in a `VITE_*` variable or in Git.

```powershell
npm install
npm run dev
npm run lint
npm run build
```

## Supabase deployment

Project reference: `nkihunpgionvbgbslmfa` (Supabase org `avkqawhrjywwrjpyctgo`, "office@mikud4me.co.il's Org"). The prior project (`dtqjbszvgkibgvxanvja`) was paused and is no longer used — do not deploy or link against it.

First-time setup links the CLI to the project and prompts for the database password:

```powershell
supabase link --project-ref nkihunpgionvbgbslmfa
```

For every database change, add a new timestamped migration under `supabase/migrations/`; do not modify an already-applied migration. Deploy it with:

```powershell
supabase db push --linked
```

Deploy the Edge Functions after function changes:

```powershell
supabase functions deploy mortgage-leads refinance-leads get-bank-of-israel-rates send-email-verification verify-email-code mortgage-ai create-cardcom-payment verify-cardcom-payment cardcom-webhook generate-pdf-report analyze-refinance-document calculate-refinance-mixes document-upload --project-ref nkihunpgionvbgbslmfa --use-api
```

Production Edge Function secrets are managed in Supabase **Edge Functions → Secrets**. Required names are:

```text
GEMINI_API_KEY
GEMINI_MODEL
RESEND_API_KEY
RESEND_FROM
CARDCOM_TERMINAL_NUMBER
CARDCOM_API_NAME
CARDCOM_WEBHOOK_URL
ALLOWED_SITE_ORIGINS
```

`analyze-refinance-document` additionally reads (all optional, with working defaults - see the file's own comments for exact behavior):

```text
AI_PROVIDERS         # comma-separated providers to race per extraction call; defaults to "gemini,openai"
OPENAI_API_KEY       # required only if "openai" is in AI_PROVIDERS
OPENAI_MODEL         # defaults to gpt-5.6-luna
OPENAI_SERVICE_TIER  # defaults to "priority" ("fast mode": higher cost, lower latency)
```

Secrets become available to functions immediately after saving; a redeployment is not needed just for a secret change.

`RESEND_API_KEY` is currently unset on the live project. This is tolerated only because `src/lib/demoMode.js` has `EMAIL_VERIFICATION_ENABLED = false`, so the frontend never calls `send-email-verification`/`verify-email-code`. Setting `EMAIL_VERIFICATION_ENABLED` back to `true` requires setting `RESEND_API_KEY` first, or email verification will fail in production.

### Observability: `ai_extraction_attempts`

`analyze-refinance-document` races Gemini and OpenAI per extraction call (see the file's own comments on `runProviderLane`/`invokeGeminiWithRetry` for the hedge/retry/cancellation design). Every attempt - both providers, every hedge and retry - is logged as its own row in the `ai_extraction_attempts` table (migration `20260828000000_add_ai_extraction_attempts.sql`), correlated by `request_id`. Query it directly via the SQL editor or `psql`; there's no dashboard view for it. Useful starting queries:

```sql
-- Win rate by provider (extraction calls only)
select provider, count(*) filter (where won_race) * 100.0 / count(*) as win_rate_pct
from ai_extraction_attempts where call_type = 'extraction' group by provider;

-- Average time-to-answer for the winning attempt, by provider
select provider, avg(duration_ms) from ai_extraction_attempts
where won_race group by provider;

-- How often hedging actually fires vs plain retries
select trigger, count(*) from ai_extraction_attempts group by trigger;
```

`net_savings_ratio` is only ever populated on the winning `extraction` row (net savings ÷ total remaining payments under the old loan), attached after the full savings calculation runs - expect it `null` on every other row.

## Cloudflare Pages deployment

Use `npx wrangler` from the repository. Build before every deployment because Pages receives the generated `dist/` directory.

Before building for a preview or production deploy, confirm `.env.local` exists in the repository root and contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see Local development above). Vite inlines these at build time; a build run without them silently ships a `dist/` where `isSupabaseConfigured` is `false`, and every Supabase-backed page (including the refinance flow) renders its "not available" fallback in production. This file does not persist between sessions or environments — check for it every time, not just once.

Preview deployment:

```powershell
npm run build
npx wrangler pages deploy .\dist --project-name baduk-ai --branch preview --commit-message "Describe the change" --commit-dirty=true
```

Production deployment:

```powershell
npm run build
npx wrangler pages deploy .\dist --project-name baduk-ai --branch main --commit-message "Describe the change" --commit-dirty=true
```

Cloudflare DNS and the custom domain are configured separately. The `baduk-ai.co.il` zone already lives in this Cloudflare account and the domain is already attached in **Workers & Pages → baduk-ai → Custom domains** — this is the account's current, working production setup, not a pending step. If setting this up again from scratch (e.g. yet another account move), the zone must be active in Cloudflare *before* attaching the custom domain from that screen, and do not create a standalone `pages.dev` CNAME before doing so.

## Git workflow

- Always commit all in-scope work after it is complete and verified; do not wait for a separate instruction to commit.
- Immediately push every new commit to the current branch's configured remote.
- Never merge a branch or pull request unless the user explicitly instructs you to merge it.
- Never deploy to preview, staging, production, Supabase, Cloudflare, or any other environment unless the user explicitly instructs you to deploy.
- If a commit or push cannot be completed safely because of authentication, conflicts, branch protection, or unrelated changes, stop and report the blocker instead of merging, force-pushing, or discarding work.

## Refinance document flow

1. `document-upload` creates a signed upload ticket for the private `documents` bucket.
2. The browser uploads the selected file using the ticket.
3. `document-upload` creates a one-hour signed read URL.
4. `analyze-refinance-document` validates that signed URL against this Supabase project, downloads it, and sends the document bytes to Gemini.

The analyzer must use `SUPABASE_URL` (or `REFINANCE_STORAGE_ORIGIN` when deliberately overridden) for signed-URL validation. Do not hard-code an old project URL.

## Before committing

- Run `npm run lint` and `npm run build`.
- Do not commit `.env.local`, `supabase/.temp/`, or `*_export.csv` files.
- Do not commit API keys, database passwords, CardCom credentials, customer documents, or exports containing customer data.
- Confirm payment flows against CardCom deliberately; a live payment test can create a real transaction.
