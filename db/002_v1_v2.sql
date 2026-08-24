-- Certwatch — migration 002: unify V1 and V2 orders
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.

-- Which API a row came from, so we know how to refresh and act on it.
alter table public.orders add column if not exists api_version text default 'v1';
alter table public.orders add column if not exists gg_category  text;   -- v2 only: ais | caas | acme
alter table public.orders add column if not exists gg_item_id   text;   -- v2 only: item id, distinct from order id
alter table public.orders add column if not exists source       text default 'sync'; -- sync | import
alter table public.orders add column if not exists last_status_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_api_version_chk') then
    alter table public.orders
      add constraint orders_api_version_chk check (api_version in ('v1','v2'));
  end if;
end $$;

-- V2 authenticates as "GGS {partner_code}:{api_password}". V1 needs only the
-- login, so the partner code is optional and V2 is skipped when it is absent.
alter table public.partner_credentials add column if not exists partner_code text;

-- Refresh oldest-first so a large book catches up predictably across runs.
create index if not exists orders_refresh_idx on public.orders(partner_id, last_status_at nulls first);
