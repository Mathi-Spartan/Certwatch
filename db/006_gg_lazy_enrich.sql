-- Certwatch — migration 006: lazy enrichment flag for GoGetSSL orders
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.
--
-- GoGetSSL's /orders/ssl/all returns only order_id + status, so on sync we
-- store orders lightweight and fill in domain/dates the first time each order
-- is opened. This flag records which rows have been enriched.

alter table public.orders add column if not exists enriched boolean not null default false;

-- Orders imported by the old CSV path or already carrying a domain are
-- effectively enriched; mark them so the UI doesn't show them as pending detail.
update public.orders set enriched = true
  where enriched = false and common_name is not null;
