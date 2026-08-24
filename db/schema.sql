-- Certwatch — schema
-- Run once in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.

-- ── profiles ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  full_name         text,
  company_name      text,
  role              text not null default 'sub_user' check (role in ('admin','partner','sub_user')),
  parent_partner_id uuid references public.profiles(id) on delete cascade,
  status            text not null default 'active' check (status in ('active','disabled')),
  created_at        timestamptz not null default now()
);
create index if not exists profiles_parent_idx on public.profiles(parent_partner_id);

-- ── partner GoGetSSL credentials ────────────────────────────────────────
-- api_password_enc holds AES-256-GCM ciphertext as iv:tag:ciphertext.
-- The key lives in CRED_ENC_KEY on Vercel and is never stored here, so a
-- database dump alone cannot recover a partner's API password.
create table if not exists public.partner_credentials (
  partner_id           uuid primary key references public.profiles(id) on delete cascade,
  gg_login             text not null,
  api_password_enc     text not null,
  auth_key             text,
  auth_key_expires_at  timestamptz,
  last_verified_at     timestamptz,
  last_sync_at         timestamptz,
  orders_synced        int default 0,
  status               text not null default 'ok' check (status in ('ok','error')),
  created_at           timestamptz not null default now()
);

-- ── orders ──────────────────────────────────────────────────────────────
create table if not exists public.orders (
  partner_id     uuid not null references public.profiles(id) on delete cascade,
  gg_order_id    text not null,
  common_name    text,
  product_name   text,
  gg_status      text,
  valid_from     date,
  valid_till     date,
  expires_at     date,
  assigned_to    uuid references public.profiles(id) on delete set null,
  assigned_at    timestamptz,
  raw            jsonb,
  last_synced_at timestamptz,
  primary key (partner_id, gg_order_id)
);
create index if not exists orders_assigned_idx on public.orders(assigned_to);
create index if not exists orders_valid_till_idx on public.orders(valid_till);

-- ── audit log ───────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id           bigserial primary key,
  actor_id     uuid,
  actor_label  text,
  partner_id   uuid,
  action       text not null,
  gg_order_id  text,
  result       text default 'ok',
  detail       text,
  created_at   timestamptz not null default now()
);
create index if not exists audit_partner_idx on public.audit_log(partner_id, created_at desc);

-- ── signup trigger: every auth user gets a profile ──────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, company_name, role, parent_partner_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'company_name',
    coalesce(new.raw_user_meta_data->>'role', 'sub_user'),
    nullif(new.raw_user_meta_data->>'parent_partner_id','')::uuid
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── row level security ──────────────────────────────────────────────────
alter table public.profiles            enable row level security;
alter table public.partner_credentials enable row level security;
alter table public.orders              enable row level security;
alter table public.audit_log           enable row level security;

-- Helpers avoid recursive policy lookups on profiles.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_partner() returns uuid
language sql stable security definer set search_path = public as $$
  select case when role = 'partner' then id else parent_partner_id end
  from public.profiles where id = auth.uid()
$$;

-- profiles
drop policy if exists p_self on public.profiles;
create policy p_self on public.profiles for select using (id = auth.uid());

drop policy if exists p_partner_reads_subs on public.profiles;
create policy p_partner_reads_subs on public.profiles for select
  using (parent_partner_id = auth.uid());

drop policy if exists p_admin_reads_all on public.profiles;
create policy p_admin_reads_all on public.profiles for select
  using (public.my_role() = 'admin');

-- partner_credentials: NOBODY reads this from the browser, ever.
-- No select policy is defined on purpose. Only the service role, inside a
-- serverless function, can touch it — and it only ever decrypts in memory.

-- orders
drop policy if exists o_partner on public.orders;
create policy o_partner on public.orders for select
  using (partner_id = auth.uid());

drop policy if exists o_subuser on public.orders;
create policy o_subuser on public.orders for select
  using (assigned_to = auth.uid());

drop policy if exists o_admin on public.orders;
create policy o_admin on public.orders for select
  using (public.my_role() = 'admin');

-- audit_log
drop policy if exists a_partner on public.audit_log;
create policy a_partner on public.audit_log for select
  using (partner_id = auth.uid());

drop policy if exists a_admin on public.audit_log;
create policy a_admin on public.audit_log for select
  using (public.my_role() = 'admin');
