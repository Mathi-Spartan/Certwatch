-- Certwatch — migration 008: partner identity fields
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.
--
-- The Add partner form now captures the partner's TheSSLStore Partner Code and
-- splits the contact into first and last name. full_name is kept and derived
-- from the two, so every existing read (Partners table, DashShell, audit
-- actor_label) keeps working untouched.

alter table public.profiles add column if not exists tss_partner_code text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name  text;

-- Backfill the split from whatever full_name already holds: everything before
-- the first space is the first name, the remainder is the last name.
update public.profiles
   set first_name = split_part(full_name, ' ', 1),
       last_name  = nullif(trim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '')
 where full_name is not null
   and first_name is null;

-- A partner code identifies one TheSSLStore account, so it should not be
-- handed to two partners by accident. Partial index: only enforced where set.
create unique index if not exists profiles_tss_partner_code_uniq
  on public.profiles(tss_partner_code)
  where tss_partner_code is not null;
