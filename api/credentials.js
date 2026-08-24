import { json, readBody, requireUser, platformFor, audit } from './_lib/db.js';
import { encrypt, maskLogin } from './_lib/crypto.js';
import { authenticate } from './_lib/gg.js';
import { verifyTss } from './_lib/tss.js';

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;
  if (profile.role !== 'partner') return json(res, 403, { error: 'Only partners connect an account' });

  const platform = platformFor(profile, req.query?.platform) || profile.platform || 'gogetssl';

  // ── GET: connection state for both platforms (or one) ──────────────────
  if (req.method === 'GET') {
    const { data } = await db.from('partner_credentials')
      .select('platform,gg_login,partner_code,tss_partner_code,tss_environment,status,last_verified_at,last_sync_at,orders_synced')
      .eq('partner_id', profile.id);
    const rows = data || [];
    const gg = rows.find(r => r.platform === 'gogetssl');
    const ts = rows.find(r => r.platform === 'thesslstore');
    return json(res, 200, {
      gogetssl: gg ? {
        connected: true, login_masked: maskLogin(gg.gg_login), partner_code: gg.partner_code || null,
        status: gg.status, last_verified_at: gg.last_verified_at, last_sync_at: gg.last_sync_at, orders_synced: gg.orders_synced,
      } : { connected: false },
      thesslstore: ts ? {
        connected: true, partner_code_masked: maskLogin(ts.tss_partner_code), environment: ts.tss_environment,
        status: ts.status, last_verified_at: ts.last_verified_at, last_sync_at: ts.last_sync_at, orders_synced: ts.orders_synced,
      } : { connected: false },
    });
  }

  // ── POST: save credentials for the chosen platform ─────────────────────
  if (req.method === 'POST') {
    const body = await readBody(req);

    if (platform === 'thesslstore') {
      const { partner_code, auth_token, environment } = body;
      if (!partner_code || !auth_token) return json(res, 400, { error: 'Enter both your TheSSLStore Partner Code and Auth Token' });
      const env = environment === 'sandbox' ? 'sandbox' : 'live';

      const check = await verifyTss({ partnerCode: String(partner_code).trim(), authToken: String(auth_token).trim(), environment: env });
      if (!check.ok) {
        await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.verify', result: 'failed', detail: `thesslstore ${env}: ${check.reason}` });
        return json(res, 400, { error: 'TheSSLStore rejected those credentials. Check the Partner Code and Auth Token for this environment.' });
      }

      const { error } = await db.from('partner_credentials').upsert({
        partner_id: profile.id, platform: 'thesslstore',
        gg_login: `tss:${env}`, // satisfies NOT NULL on the shared column
        api_password_enc: 'n/a',
        tss_partner_code: String(partner_code).trim(),
        tss_auth_token_enc: encrypt(auth_token),
        tss_environment: env,
        last_verified_at: new Date().toISOString(), status: 'ok',
      }, { onConflict: 'partner_id,platform' });
      if (error) return json(res, 500, { error: error.message });

      await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.saved', result: 'ok', detail: `thesslstore ${env}` });
      return json(res, 200, { connected: true, environment: env });
    }

    // GoGetSSL
    const { login, api_password, partner_code } = body;
    if (!login || !api_password) return json(res, 400, { error: 'Enter both your GoGetSSL login and API password' });
    let key;
    try { key = await authenticate(String(login).trim(), String(api_password)); }
    catch (e) {
      await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.verify', result: 'failed', detail: e.message });
      return json(res, 400, { error: 'GoGetSSL rejected those credentials. Check the API password under Reseller Modules -> API settings.' });
    }
    let v2_ok = null;
    if (partner_code) {
      try {
        const r = await fetch('https://my.gogetssl.com/api/v2/products', { headers: { Authorization: `GGS ${String(partner_code).trim()}:${api_password}` } });
        v2_ok = r.ok;
      } catch { v2_ok = false; }
    }
    const { error } = await db.from('partner_credentials').upsert({
      partner_id: profile.id, platform: 'gogetssl',
      gg_login: String(login).trim(),
      partner_code: partner_code ? String(partner_code).trim() : null,
      api_password_enc: encrypt(api_password),
      auth_key: key, auth_key_expires_at: new Date(Date.now() + 150 * 60 * 1000).toISOString(),
      last_verified_at: new Date().toISOString(), status: 'ok',
    }, { onConflict: 'partner_id,platform' });
    if (error) return json(res, 500, { error: error.message });

    await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.saved', result: 'ok', detail: partner_code ? (v2_ok ? 'gogetssl v1 + v2' : 'gogetssl v1 only') : 'gogetssl v1 only' });
    return json(res, 200, { connected: true, login_masked: maskLogin(String(login).trim()), v2_ok });
  }

  // ── DELETE: disconnect one platform ────────────────────────────────────
  if (req.method === 'DELETE') {
    await db.from('partner_credentials').delete().eq('partner_id', profile.id).eq('platform', platform);
    await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.disconnected', result: 'ok', detail: platform });
    return json(res, 200, { connected: false });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
