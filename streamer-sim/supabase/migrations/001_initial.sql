-- ─────────────────────────────────────────────────────────────────────────────
-- 001 — Initial schema: profiles + saves
-- ─────────────────────────────────────────────────────────────────────────────

-- One profile per Supabase Auth user.
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text,
  subscription_status  text not null default 'free',   -- 'free' | 'active' | 'cancelled' | 'past_due'
  subscription_tier    text not null default 'free',   -- 'free' | 'pro'
  ls_customer_id       text,       -- LemonSqueezy customer_id
  ls_subscription_id   text,       -- LemonSqueezy subscription_id
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One row per save slot per user. state_json holds the full Zustand persist blob.
create table public.saves (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  slot_id         text        not null,          -- matches localStorage limelight-slot:{uuid}
  slot_name       text        not null default 'Save',
  state_json      jsonb       not null default '{}',
  character_name  text,
  day             integer     not null default 1,
  portrait_id     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, slot_id)
);

-- ── Row-level security ───────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.saves     enable row level security;

create policy "profiles: own read/write"
  on public.profiles for all
  using      (auth.uid() = id)
  with check (auth.uid() = id);

create policy "saves: own read/write"
  on public.saves for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Auto-create profile on sign-up ──────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
