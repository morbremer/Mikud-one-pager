-- Per-attempt log for the multi-provider (Gemini + OpenAI) extraction race in
-- analyze-refinance-document. One row per attempt (not per request): a
-- single logical extraction call can produce several rows across the two
-- provider lanes (initial attempt, a 45s hedge if slow, or an error-retry).
-- Lets us later query win rate by provider, latency, and how often hedging
-- actually fires - none of that is derivable from console logs alone.
create table if not exists public.ai_extraction_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id uuid not null,
  call_type text not null,        -- 'extraction' | 'identity' | 'fallback-retry' | 'track-retry'
  provider text not null,         -- 'gemini' | 'openai'
  model text not null,
  attempt_number int not null,    -- 1, 2, 3... within this provider's own lane
  trigger text not null,          -- 'initial' | 'hedge' | 'retry'
  outcome text not null,          -- 'success' | 'error' | 'aborted'
  won_race boolean not null default false,
  duration_ms int not null,
  error_message text,
  error_status int,
  net_savings_ratio numeric       -- only ever set on the winning 'extraction' row, via a later update
);

alter table public.ai_extraction_attempts enable row level security;
-- No select/insert/update policies for anon/authenticated: RLS denies all
-- client access by default. Only the service role (this edge function,
-- via its own REST calls) can read/write - same lockdown as boi_rate_cache.

create index if not exists ai_extraction_attempts_request_id_idx
  on public.ai_extraction_attempts (request_id);
create index if not exists ai_extraction_attempts_analysis_idx
  on public.ai_extraction_attempts (call_type, provider, outcome, created_at);
