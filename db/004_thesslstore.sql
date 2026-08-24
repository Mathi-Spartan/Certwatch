-- Certwatch — migration 004: second platform (TheSSLStore)
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.
--
-- Certwatch now spans two reseller platforms. A partner may connect either or
-- both and choose one at login. Everything hangs off a `platform` value so the
-- rest of the app can stay platform-blind.

-- ── credentials become per-platform ────────────────────────────────────
-- The existing partner_credentials row is GoGetSSL. We add a platform key and
-- a second row type for TheSSLStore, whose auth is PartnerCode + AuthToken
-- against either the live or sandbox base URL.
alter table public.partner_credentials add column if not exists platform text not null default 'gogetssl';
alter table public.partner_credentials add column if not exists tss_partner_code text;
alter table public.partner_credentials add column if not exists tss_auth_token_enc text;   -- AES-256-GCM, same scheme as GoGetSSL
alter table public.partner_credentials add column if not exists tss_environment text default 'live'; -- live | sandbox

-- The primary key was partner_id alone; a partner can now hold one row per
-- platform, so widen it.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name='partner_credentials' and constraint_type='PRIMARY KEY'
      and constraint_name='partner_credentials_pkey'
  ) then
    -- only recreate if it is still the single-column key
    if (select count(*) from information_schema.key_column_usage
        where constraint_name='partner_credentials_pkey') = 1 then
      alter table public.partner_credentials drop constraint partner_credentials_pkey;
      alter table public.partner_credentials add primary key (partner_id, platform);
    end if;
  end if;
end $$;

-- ── orders carry their platform ────────────────────────────────────────
alter table public.orders add column if not exists platform text not null default 'gogetssl';

-- The order key was (partner_id, gg_order_id). Two platforms can, in principle,
-- collide on an id, so platform joins the key.
do $$
begin
  if (select count(*) from information_schema.key_column_usage
      where constraint_name='orders_pkey') = 2 then
    alter table public.orders drop constraint orders_pkey;
    alter table public.orders add primary key (partner_id, platform, gg_order_id);
  end if;
end $$;

create index if not exists orders_platform_idx on public.orders(partner_id, platform);

-- Which platforms a sub-user's parent has connected is derived at query time,
-- so no column is needed on profiles.
