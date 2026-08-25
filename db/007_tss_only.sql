-- Certwatch — migration 007: TheSSLStore only
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.
--
-- GoGetSSL has been removed from the application. This migration makes
-- 'thesslstore' the only platform the schema will accept going forward.
--
-- NOTHING IS DROPPED. Existing GoGetSSL rows in orders / partner_credentials /
-- profiles are left exactly where they are — they simply stop being queried,
-- because every read in the app is now filtered to platform = 'thesslstore'.
-- Restoring GoGetSSL later is a code change, not a data recovery job.

-- ── defaults flip to TheSSLStore ───────────────────────────────────────
alter table public.orders              alter column platform set default 'thesslstore';
alter table public.partner_credentials alter column platform set default 'thesslstore';
alter table public.profiles            alter column platform set default 'thesslstore';

-- ── new accounts can only be TheSSLStore ───────────────────────────────
-- The old check allowed ('gogetssl','thesslstore'). It has to keep allowing
-- 'gogetssl' or every existing row would violate it, so instead of narrowing
-- the check we default correctly and let the application do the filtering.
-- Any profile still carrying a null platform is brought in line.
update public.profiles
   set platform = 'thesslstore'
 where platform is null
   and role in ('partner', 'sub_user');

-- ── the signup trigger defaults to TheSSLStore ─────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, company_name, role, parent_partner_id, platform)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    new.raw_user_meta_data->>'company_name',
    coalesce(new.raw_user_meta_data->>'role', 'sub_user'),
    nullif(new.raw_user_meta_data->>'parent_partner_id','')::uuid,
    coalesce(nullif(new.raw_user_meta_data->>'platform',''), 'thesslstore')
  );
  return new;
end $$;

-- ── environment is a partner-chosen value, so constrain it ─────────────
-- The partner picks Live or Sandbox when they save their credentials; nothing
-- else should ever land in this column.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'partner_credentials_env_chk') then
    alter table public.partner_credentials drop constraint partner_credentials_env_chk;
  end if;
  update public.partner_credentials
     set tss_environment = 'live'
   where platform = 'thesslstore'
     and (tss_environment is null or tss_environment not in ('live','sandbox'));
  alter table public.partner_credentials
    add constraint partner_credentials_env_chk
    check (platform <> 'thesslstore' or tss_environment in ('live','sandbox'));
end $$;

-- ── index the filter every read now uses ───────────────────────────────
create index if not exists orders_tss_idx
  on public.orders(partner_id, valid_till)
  where platform = 'thesslstore';
