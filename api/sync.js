import { json, requireUser, partnerIdOf, ggKeyFor, audit } from './_lib/db.js';
import { gg, normaliseOrder } from './_lib/gg.js';

/** Pull the partner's whole GoGetSSL order book and upsert it. */
export async function syncPartner(db, partnerId, actor) {
  const { key } = await ggKeyFor(db, partnerId);
  const list = await gg.listOrders(key);
  const orders = Array.isArray(list) ? list : (list.orders || list.data || []);

  let seen = 0;
  for (const o of orders) {
    const n = normaliseOrder(o);
    if (!n.gg_order_id) continue;
    seen++;
    await db.from('orders').upsert({
      partner_id: partnerId,
      ...n,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'partner_id,gg_order_id', ignoreDuplicates: false });
  }

  await db.from('partner_credentials').update({
    last_sync_at: new Date().toISOString(),
    orders_synced: seen,
    status: 'ok',
  }).eq('partner_id', partnerId);

  await audit(db, { actor, partnerId, action: 'orders.sync', result: 'ok', detail: `${seen} orders` });
  return seen;
}

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  const partnerId = profile.role === 'admin' ? (req.query?.partner_id || null) : partnerIdOf(profile);
  if (!partnerId) return json(res, 400, { error: 'No partner account to sync' });
  if (profile.role === 'sub_user') return json(res, 403, { error: 'Ask your partner to run a sync' });

  try {
    const n = await syncPartner(db, partnerId, profile);
    return json(res, 200, { ok: true, orders: n });
  } catch (e) {
    await db.from('partner_credentials').update({ status: 'error' }).eq('partner_id', partnerId);
    await audit(db, { actor: profile, partnerId, action: 'orders.sync', result: 'failed', detail: e.message });
    return json(res, e.code || 502, { error: e.message });
  }
}
