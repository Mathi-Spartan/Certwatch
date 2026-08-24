-- Certwatch — migration 005: bind partner/sub-user accounts to a platform
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.
--
-- Model B: a partner account belongs to exactly one platform (gogetssl or
-- thesslstore) and only ever sees that platform. Sub-users inherit their
-- parent's platform. The master admin is platform-agnostic (null) and sees
-- across both.

alter table public.profiles add column if not exists platform text
  check (platform in ('gogetssl','thesslstore'));

-- Carry the platform through the signup trigger, the same way role is carried.
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
    nullif(new.raw_user_meta_data->>'platform','')
  );
  return new;
end $$;

-- Helper: the platform of the calling user (null for admin), for RLS.
create or replace function public.my_platform() returns text
language sql stable security definer set search_path = public as $$
  select platform from public.profiles where id = auth.uid()
$$;
