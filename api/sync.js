import { json, requireUser, partnerIdOf, audit } from './_lib/db.js';
import { gg, normaliseOrder } from './_lib/gg.js';
import { credsFor, refreshKnown } from './_lib/resolve.js';

/**
 * Bring a partner's order book up to date.
 *
 * Two passes, because no single call can produce a complete book:
 *   1. Discovery — V1 listing across every status it will accept. This is the
 *      only bulk source either API offers.
 *   2. Refresh — re-read every order we already know, by id, across V1 and V2.
 *      This is what keeps cancelled and V2 orders present and accurate, since
 *      neither can be discovered from a listing.
 */
export async function syncPartner(db, partnerId, actor) {
  const creds = await credsFor(db, partnerId);

  let discovered = 0;
  try {
    const list = await gg.listAll(creds.v1);
    for (const o of list) {
      const n = normaliseOrder(o);
      if (!n.gg_order_id) continue;
      discovered++;
      await db.from('orders').upsert({
        partner_id: partnerId,
        ...n,
        source: 'sync',
        last_synced_at: new Date().toISOString(),
        last_status_at: new Date().toISOString(),
      }, { onConflict: 'partner_id,gg_order_id' });
    }
  } catch (e) {
    await audit(db, { actor, partnerId, action: 'orders.discover', result: 'failed', detail: e.message });
  }

  const refreshed = await refreshKnown(db, partnerId, creds);

  const { count } = await db.from('orders')
    .select('gg_order_id', { count: 'exact', head: true })
    .eq('partner_id', partnerId);

  await db.from('partner_credentials').update({
    last_sync_at: new Date().toISOString(),
    orders_synced: count || 0,
    status: 'ok',
  }).eq('partner_id', partnerId);

  await audit(db, {
    actor, partnerId, action: 'orders.sync', result: 'ok',
    detail: `${discovered} listed, ${refreshed.updated} refreshed, ${count || 0} total`,
  });

  return { discovered, ...refreshed, total: count || 0 };
}

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  if (profile.role === 'sub_user') return json(res, 403, { error: 'Ask your partner to run a sync' });
  const partnerId = profile.role === 'admin' ? (req.query?.partner_id || null) : partnerIdOf(profile);
  if (!partnerId) return json(res, 400, { error: 'No partner account to sync' });

  try {
    const r = await syncPartner(db, partnerId, profile);
    return json(res, 200, { ok: true, ...r });
  } catch (e) {
    await db.from('partner_credentials').update({ status: 'error' }).eq('partner_id', partnerId);
    await audit(db, { actor: profile, partnerId, action: 'orders.sync', result: 'failed', detail: e.message });
    return json(res, e.code || 502, { error: e.message });
  }
}
