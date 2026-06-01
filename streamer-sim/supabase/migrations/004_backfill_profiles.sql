-- ─────────────────────────────────────────────────────────────────────────────
-- 004 — Backfill profiles for pre-existing auth users
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Users who signed up before the handle_new_user trigger existed (or if the
-- trigger ever failed to fire) have an auth.users row but no public.profiles
-- row. That breaks everything keyed on the profile: the tier lookup 406s, save
-- upserts hit the saves_user_id_fkey foreign key, and per-user OpenRouter key
-- minting fails the user_openrouter_keys FK. Backfill any missing profiles.

insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Re-assert the auto-create trigger idempotently, in case it was missing.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
