# Certwatch

Certificate management for GoGetSSL partners.

Partners connect **their own** GoGetSSL account. Certwatch reads their order
book, and lets them and their sub-users manage certificates — reissue,
download, and run domain validation.

## Roles

| Role | Can do |
|---|---|
| Admin | Create partner accounts, see connection health and the full activity log. Cannot see or act on partner certificates. |
| Partner | Connect a GoGetSSL account, see the whole order book, create sub-users, assign certificates, manage any certificate. |
| Sub-user | Manage the certificates assigned to them: reissue, download, check and drive domain validation, cancel. |

## What this cannot do, by design

There is no `addSSLOrder`, `addSSLRenewOrder` or `addSSLSANOrder` anywhere in
this codebase. **Certwatch cannot place an order or a renewal, so it cannot
spend a partner's GoGetSSL balance** — not through a bug, not through a
compromise. Renewals stay in the partner's own GoGetSSL account.

## Credential handling

A partner's GoGetSSL API password is encrypted with AES-256-GCM before it is
stored. The key is `CRED_ENC_KEY`, held only in the Vercel environment, so a
database dump on its own reveals nothing. The ciphertext is never sent to the
browser: `partner_credentials` has **no RLS select policy at all**, and the
password is decrypted only inside a serverless function, in memory, for the
duration of one API call. Every call made with a partner's credentials is
written to `audit_log`.

Private keys are never handled server-side. When a user asks Certwatch to
generate a CSR, the keypair is built in their browser with node-forge and
packaged into a ZIP locally. Only the CSR — public by design — is sent onward.

## Setup

1. Run `db/schema.sql` in the Supabase SQL editor.
2. Set the environment variables below in Vercel.
3. Create the first admin by inserting a profile row with `role = 'admin'`.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key (public) |
| `SUPABASE_URL` | Same URL, server side |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — server only |
| `CRED_ENC_KEY` | 64 hex characters (32 bytes) for AES-256-GCM |
| `CRON_SECRET` | Guards the scheduled sync endpoint |
| `PUBLIC_SITE_URL` | Used to build invite links |

`GET /api/health` reports which of these are present and whether the
encryption key is well formed. It never echoes a value.

## GoGetSSL V1 endpoints

Verified against the live API by probing with an invalid auth key: a `403
"Auth key is not valid"` proves the path exists, a `404 "The requested method
was not found"` proves it does not. POST-only routes answer 404 to a GET, so
each was probed with its real verb.

| Action | Verb | Path |
|---|---|---|
| Authenticate | POST | `/auth/` (fields `user`, `pass`) |
| List orders | GET | `/orders/` |
| Order status | GET | `/orders/status/{id}/` |
| Reissue | POST | `/orders/ssl/reissue/{id}/` |
| Change DCV method | POST | `/orders/ssl/change_validation_method/{id}/` |
| Change approver | POST | `/orders/ssl/change_validation_email/{id}/` |
| Resend approver | POST | `/orders/ssl/resend_validation_email/{id}/` |
| Revalidate | POST | `/orders/ssl/revalidate/{id}/` |
| Cancel | POST | `/orders/cancel_ssl_order/` (order id in the **body**) |
