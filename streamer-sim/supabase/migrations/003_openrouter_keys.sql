-- ─────────────────────────────────────────────────────────────────────────────
-- 003 — Per-user OpenRouter runtime keys
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One minted OpenRouter runtime key per user. The openrouter-proxy edge function
-- mints these from the provisioning (management) key on a user's first request,
-- with a monthly spend cap scaled to their subscription tier, and forwards
-- inference using the per-user key (so usage is metered and capped per user).
--
-- encrypted_key holds the runtime secret, tagged for at-rest crypto:
--   plain:sk-or-...   — stored as plaintext (RLS-protected, service-role only)
--   enc:v1:<base64>   — AES-GCM, key derived from KEY_ENCRYPTION_SECRET
-- key_hash is the OpenRouter key hash, used to PATCH/disable the key later.

create table public.user_openrouter_keys (
  user_id        uuid        primary key references public.profiles(id) on delete cascade,
  key_hash       text        not null,
  encrypted_key  text        not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- RLS on, no policies: only the service role (edge functions) may touch this
-- table. End-user JWTs are denied entirely — clients must never read a key.
alter table public.user_openrouter_keys enable row level security;
