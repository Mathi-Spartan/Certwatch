import { json, readBody, requireUser, audit, PLATFORM } from './_lib/db.js';
import { encrypt, maskLogin } from './_lib/crypto.js';
import { verifyTss } from './_lib/tss.js';

/**
 * A partner's TheSSLStore connection.
 *
 * The partner chooses the environment (live or sandbox) when they save the
 * credentials, and that choice is stored on the credential row — every call
 * Certwatch later makes on their behalf hits the base URL for that
 * environment. Switching environments is done by saving credentials again.
 */
export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;
  if (profile.role !== 'partner') return json(res, 403, { error: 'Only partners connect an account' });

  // ── GET: current connection state ─────────────────────────────────────
  if (req.method === 'GET') {
    const { data } = await db.from('partner_credentials')
      .select('tss_partner_code,tss_environment,status,last_verified_at,last_sync_at,orders_synced')
      .eq('partner_id', profile.id)
      .eq('platform', PLATFORM)
      .maybeSingle();

    return json(res, 200, data ? {
      connected: true,
      partner_code_masked: maskLogin(data.tss_partner_code),
      environment: data.tss_environment || 'live',
      status: data.status,
      last_verified_at: data.last_verified_at,
      last_sync_at: data.last_sync_at,
      orders_synced: data.orders_synced,
    } : { connected: false });
  }

  // ── POST: save credentials for the chosen environment ─────────────────
  if (req.method === 'POST') {
    const { partner_code, auth_token, environment } = await readBody(req);
    if (!partner_code || !auth_token) {
      return json(res, 400, { error: 'Enter both your TheSSLStore Partner Code and Auth Token' });
    }
    if (environment !== 'live' && environment !== 'sandbox') {
      return json(res, 400, { error: 'Choose Live or Sandbox before saving' });
    }

    const creds = {
      partnerCode: String(partner_code).trim(),
      authToken: String(auth_token).trim(),
      environment,
    };

    const check = await verifyTss(creds);
    if (!check.ok) {
      await audit(db, {
        actor: profile, partnerId: profile.id, action: 'credentials.verify',
        result: 'failed', detail: `${environment}: ${check.reason}`,
      });
      return json(res, 400, {
        error: `TheSSLStore rejected those credentials against the ${environment} environment. A ${environment} Partner Code and Auth Token only work in ${environment} — check you generated them there.`,
      });
    }

    const { error } = await db.from('partner_credentials').upsert({
      partner_id: profile.id,
      platform: PLATFORM,
      tss_partner_code: creds.partnerCode,
      tss_auth_token_enc: encrypt(creds.authToken),
      tss_environment: environment,
      last_verified_at: new Date().toISOString(),
      status: 'ok',
    }, { onConflict: 'partner_id,platform' });
    if (error) return json(res, 500, { error: error.message });

    await audit(db, {
      actor: profile, partnerId: profile.id, action: 'credentials.saved',
      result: 'ok', detail: environment,
    });
    return json(res, 200, { connected: true, environment });
  }

  // ── DELETE: disconnect ────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    await db.from('partner_credentials').delete()
      .eq('partner_id', profile.id).eq('platform', PLATFORM);
    await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.disconnected', result: 'ok' });
    return json(res, 200, { connected: false });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
