-- Certwatch — migration 009: drop the last GoGetSSL columns
-- Run in the Supabase SQL editor for project ctcgybovsvpqipclwtdr.
-- Safe to run more than once.
--
-- partner_credentials was built for GoGetSSL, so gg_login and api_password_enc
-- were declared NOT NULL. TheSSLStore has neither: its auth is a Partner Code
-- plus an Auth Token, held in tss_partner_code / tss_auth_token_enc.
--
-- While both platforms coexisted, the TheSSLStore path satisfied the two
-- constraints with dummy values ('tss:live' and 'n/a'). Removing GoGetSSL
-- removed the dummies, so a real credential save now fails with:
--   null value in column "gg_login" violates not-null constraint
--
-- Nothing in api/ or src/ reads or writes either column any more — verified by
-- grep before writing this. Dropping them is the fix; re-adding placeholder
-- values would only put the hack back.

alter table public.partner_credentials drop column if exists gg_login;
alter table public.partner_credentials drop column if exists api_password_enc;

-- auth_key / auth_key_expires_at cached the GoGetSSL V1 session key, which
-- expired every three hours. TheSSLStore has no session handshake, so these
-- are dead too. They are nullable, so they were not breaking anything — they
-- are removed here to keep the table honest about what it holds.
alter table public.partner_credentials drop column if exists auth_key;
alter table public.partner_credentials drop column if exists auth_key_expires_at;

-- What the table should look like afterwards:
--   partner_id, platform, tss_partner_code, tss_auth_token_enc,
--   tss_environment, last_verified_at, last_sync_at, orders_synced,
--   status, created_at
select column_name, is_nullable, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'partner_credentials'
 order by ordinal_position;
