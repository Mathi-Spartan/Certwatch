import { json, readBody, requireUser, partnerIdOf, audit, admin } from './_lib/db.js';
import { encrypt, maskLogin } from './_lib/crypto.js';
import { authenticate } from './_lib/gg.js';

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  if (profile.role !== 'partner') {
    return json(res, 403, { error: 'Only partners connect a GoGetSSL account' });
  }

  if (req.method === 'GET') {
    const { data } = await db.from('partner_credentials').select('gg_login,partner_code,status,last_verified_at,last_sync_at,orders_synced').eq('partner_id', profile.id).single();
    if (!data) return json(res, 200, { connected: false });
    return json(res, 200, {
      connected: true,
      login_masked: maskLogin(data.gg_login),
      partner_code: data.partner_code || null,
      status: data.status,
      last_verified_at: data.last_verified_at,
      last_sync_at: data.last_sync_at,
      orders_synced: data.orders_synced,
    });
  }

  if (req.method === 'POST') {
    const { login, api_password, partner_code } = await readBody(req);
    if (!login || !api_password) return json(res, 400, { error: 'Enter both your GoGetSSL login and API password' });

    // Verify before storing: a bad credential should fail here, not silently later.
    let key;
    try {
      key = await authenticate(String(login).trim(), String(api_password));
    } catch (e) {
      await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.verify', result: 'failed', detail: e.message });
      return json(res, 400, { error: 'GoGetSSL rejected those credentials. Check the API password under Reseller Modules -> API settings.' });
    }

    // The partner code unlocks the V2 API. It is optional: without it we still
    // work, but only V1 orders are reachable.
    let v2_ok = null;
    if (partner_code) {
      try {
        const r = await fetch('https://my.gogetssl.com/api/v2/products', {
          headers: { Authorization: `GGS ${String(partner_code).trim()}:${api_password}` },
        });
        v2_ok = r.ok;
      } catch { v2_ok = false; }
    }

    const row = {
      partner_id: profile.id,
      gg_login: String(login).trim(),
      partner_code: partner_code ? String(partner_code).trim() : null,
      api_password_enc: encrypt(api_password),
      auth_key: key,
      auth_key_expires_at: new Date(Date.now() + 150 * 60 * 1000).toISOString(),
      last_verified_at: new Date().toISOString(),
      status: 'ok',
    };
    const { error } = await db.from('partner_credentials').upsert(row, { onConflict: 'partner_id' });
    if (error) return json(res, 500, { error: error.message });

    await audit(db, {
      actor: profile, partnerId: profile.id, action: 'credentials.saved', result: 'ok',
      detail: partner_code ? (v2_ok ? 'v1 + v2' : 'v1 only, partner code rejected by v2') : 'v1 only, no partner code',
    });
    return json(res, 200, { connected: true, login_masked: maskLogin(row.gg_login), v2_ok });
  }

  if (req.method === 'DELETE') {
    await db.from('partner_credentials').delete().eq('partner_id', profile.id);
    await audit(db, { actor: profile, partnerId: profile.id, action: 'credentials.disconnected', result: 'ok' });
    return json(res, 200, { connected: false });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
