-- Certwatch — migration 003: accept the GoGetSSL panel export
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.
--
-- Why this exists: the V1 API will not enumerate cancelled orders, and none of
-- the identifiers shown in the panel list (Id, Order number, Vendor Order ID)
-- are accepted by any API route. The only complete record of a cancelled book
-- is the panel's CSV export, so we store those rows directly.
--
-- A CSV row is keyed by its "Order number" (S3574059) rather than a numeric
-- API order id, so it can never collide with a real one. getOrderStatus returns
-- that same value as `internal_id`, which is how a CSV row and an API row are
-- recognised as the same order and merged.

alter table public.orders add column if not exists internal_id text;   -- S3574059, the panel's "Order number"
alter table public.orders add column if not exists panel_id    text;   -- the /en/certificates/NNNN id
alter table public.orders add column if not exists api_linked  boolean not null default true;
alter table public.orders add column if not exists price       text;
alter table public.orders add column if not exists ordered_at  timestamptz;

create index if not exists orders_internal_idx on public.orders(partner_id, internal_id);

-- 'panel' joins 'sync' and 'import' as a provenance value.
comment on column public.orders.source is 'sync | import | panel';
comment on column public.orders.api_linked is
  'false when the row came from a CSV export and we have no API order id for it, so no action can be taken against the CA';
