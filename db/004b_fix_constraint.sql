-- Certwatch — hotfix: allow api_version = 'tss'
-- The check from migration 002 only permitted 'v1' and 'v2', which silently
-- rejected every TheSSLStore order on sync. Run this in the Supabase SQL editor.
alter table public.orders drop constraint if exists orders_api_version_chk;
alter table public.orders
  add constraint orders_api_version_chk check (api_version in ('v1','v2','tss'));
