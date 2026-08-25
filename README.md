# Certwatch

Certificate management for TheSSLStore partners.

Partners connect **their own** TheSSLStore account — live or sandbox — and
Certwatch reads their order book and lets them and their sub-users manage
certificates: reissue, download, and run domain validation.

## Roles

| Role | Can do |
|---|---|
| Admin | Create partner accounts, see connection health and the full activity log. Cannot see or act on partner certificates. |
| Partner | Connect a TheSSLStore account, see the whole order book, create sub-users, assign certificates, manage any certificate. |
| Sub-user | Manage the certificates assigned to them: reissue, download, check and drive domain validation, revoke. |

## Live and sandbox

TheSSLStore issues a separate Partner Code and Auth Token for each of its two
environments. The partner chooses which environment their credentials belong to
in the same box where they save them, and that choice is stored on the
credential row — so every later call automatically goes to the matching base
URL. A sandbox token will not verify against live, and vice versa; the save is
rejected with a message saying so rather than being stored broken.

| Environment | Base URL |
|---|---|
| Live | `https://api.thesslstore.com/rest` |
| Sandbox | `https://sandbox-wbapi.thesslstore.com/rest` |

Switching environments means saving credentials again. Orders already synced
from the previous environment stay in the list until the next sync replaces
them.

## What this cannot do, by design

There is no order-placement or renewal call anywhere in this codebase.
**Certwatch cannot place an order or a renewal, so it cannot spend a partner's
balance** — not through a bug, not through a compromise. Renewals stay in the
partner's own TheSSLStore account.

## Credential handling

A partner's TheSSLStore Auth Token is encrypted with AES-256-GCM before it is
stored. The key is `CRED_ENC_KEY`, held only in the Vercel environment, so a
database dump on its own reveals nothing. The ciphertext is never sent to the
browser: `partner_credentials` has **no RLS select policy at all**, and the
token is decrypted only inside a serverless function, in memory, for the
duration of one API call. Every call made with a partner's credentials is
written to `audit_log`.

Private keys never reach the server. When someone asks Certwatch to generate a
CSR, the keypair is built in their browser with node-forge and packaged into a
ZIP locally. Only the CSR — public by design — is sent onward.

## Setup

1. Run `db/schema.sql`, then migrations `002` through `007`, in the Supabase
   SQL editor.
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

## TheSSLStore endpoints in use

Auth is a `PartnerCode` + `AuthToken` pair in an `AuthRequest` object in the
body of every POST — there is no session handshake. Errors surface inside
`AuthResponse.isError`, not in the HTTP status.

| Action | Path |
|---|---|
| List the whole order book | `/order/query` |
| Order status | `/order/status` |
| Reissue | `/order/reissue` |
| Download certificate | `/order/download` |
| Resend approver email | `/order/resend` |
| Change approver | `/order/changeapprovermethod` |
| Revoke | `/order/revokerequest` |

`/order/query` returns every order in one call, cancelled ones included, so a
sync is always complete — there is no listing gap and nothing ever needs
importing by hand.

Credentials are validated against `/order/status`, not `/order/query`: verified
in sandbox, `/order/query` does not reject a bad token but `/order/status`
does, returning `-9008 Token/Authentication Failure`.

## History

GoGetSSL support was removed from this project in August 2026. Existing
GoGetSSL rows were deliberately left in the database rather than dropped — see
`db/007_tss_only.sql`. Migrations `003` through `006` are kept as an applied
ledger; they describe schema that has already been run against production and
should not be edited or deleted.
