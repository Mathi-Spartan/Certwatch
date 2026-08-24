import { decrypt } from './crypto.js';
import { gg, authenticate, normaliseOrder } from './gg.js';
import { gg2, normaliseV2 } from './gg2.js';

/**
 * One place that knows both APIs, so nothing above it has to.
 *
 * Certwatch treats a partner's order book as a single list. Underneath, an
 * order lives in either the V1 reseller API or the V2 partner API, and neither
 * can see the other's rows. This module resolves an order id against both and
 * returns a normalised record with the CA's exact status, whatever it is —
 * including cancelled, which no listing endpoint will report.
 */

/** Load a partner's credentials once and hand back everything both APIs need. */
export async function credsFor(db, partnerId) {
  const { data: cred } = await db
    .from('partner_credentials')
    .select('*')
    .eq('partner_id', partnerId)
    .single();

  if (!cred) {
    const e = new Error('This partner has not connected a GoGetSSL account yet');
    e.code = 409;
    throw e;
  }

  const password = decrypt(cred.api_password_enc);

  // V1 session keys last about three hours; reuse while fresh.
  let key = cred.auth_key;
  if (!key || !cred.auth_key_expires_at || new Date(cred.auth_key_expires_at) <= new Date()) {
    key = await authenticate(cred.gg_login, password);
    await db.from('partner_credentials').update({
      auth_key: key,
      auth_key_expires_at: new Date(Date.now() + 150 * 60 * 1000).toISOString(),
      last_verified_at: new Date().toISOString(),
      status: 'ok',
    }).eq('partner_id', partnerId);
  }

  return {
    v1: key,
    v2: { partnerCode: cred.partner_code, password },
    hasV2: !!cred.partner_code,
    cred,
  };
}

/**
 * Read one order's current state. Tries the API we already know it belongs to
 * first, then the other — an order never changes API, but on import we do not
 * yet know which one it is.
 */
export async function resolveOrder(creds, orderId, hint = {}) {
  const tryV1 = async () => {
    const raw = await gg.orderStatus(creds.v1, orderId);
    if (!raw || raw.error) return null;
    return {
      ...normaliseOrder({ ...raw, order_id: raw.order_id ?? orderId }),
      raw,
    };
  };

  const tryV2 = async () => {
    if (!creds.hasV2) return null;
    // A known category is an exact hit; otherwise try each in turn.
    if (hint.gg_category) {
      const id = hint.gg_category === 'acme' ? orderId : (hint.gg_item_id || orderId);
      try {
        const data = await gg2.certificate(creds.v2, hint.gg_category, id);
        if (data?.order?.id) return await normaliseV2(creds.v2, hint.gg_category, data);
      } catch { /* fall through to a full sweep */ }
    }
    const found = await gg2.resolve(creds.v2, orderId);
    return found ? await normaliseV2(creds.v2, found.category, found.data) : null;
  };

  const order = [tryV1, tryV2];
  if (hint.api_version === 'v2') order.reverse();

  for (const attempt of order) {
    try {
      const got = await attempt();
      if (got) return got;
    } catch (e) {
      // "Invalid order ID N for customer M" simply means it is not in that API.
      if (e.status && e.status >= 500) throw e;
    }
  }
  return null;
}

/**
 * Refresh the stored copies of orders we already know about.
 *
 * This is what keeps a cancelled order visible with its true status: listings
 * drop it, but we re-read it by id and record whatever the CA now says. Capped
 * per run so a large book cannot blow the function timeout — oldest first, so
 * repeated runs cover everything.
 */
export async function refreshKnown(db, partnerId, creds, { limit = 40 } = {}) {
  const { data: rows } = await db
    .from('orders')
    .select('gg_order_id, api_version, gg_category, gg_item_id')
    .eq('partner_id', partnerId)
    .order('last_status_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  let updated = 0, missing = 0;
  for (const row of rows || []) {
    const fresh = await resolveOrder(creds, row.gg_order_id, row);
    if (!fresh) { missing++; continue; }
    await db.from('orders').update({
      ...fresh,
      last_synced_at: new Date().toISOString(),
      last_status_at: new Date().toISOString(),
    }).eq('partner_id', partnerId).eq('gg_order_id', row.gg_order_id);
    updated++;
  }
  return { updated, missing, checked: (rows || []).length };
}
