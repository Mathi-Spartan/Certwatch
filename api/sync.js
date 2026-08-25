import { json, requireUser, partnerIdOf, audit, PLATFORM } from './_lib/db.js';
import { tss, tssCredsFor, normaliseTss } from './_lib/tss.js';

/**
 * TheSSLStore returns the whole order book in one call, every status included —
 * cancelled orders too. So a sync is always complete: there is no listing gap
 * and nothing ever needs importing by hand.
 */
export async function syncPartner(db, partnerId, actor) {
  const creds = await tssCredsFor(db, partnerId);
  const list = await tss.listOrders(creds);

  let discovered = 0, failed = 0, firstError = null;
  for (const o of Array.isArray(list) ? list : []) {
    const n = normaliseTss(o);
    if (!n.gg_order_id) continue;
    const { error } = await db.from('orders').upsert({
      partner_id: partnerId, ...n,
      source: 'sync', api_linked: true,
      last_synced_at: new Date().toISOString(),
      last_status_at: new Date().toISOString(),
    }, { onConflict: 'partner_id,platform,gg_order_id' });
    if (error) { failed++; if (!firstError) firstError = error.message; }
    else discovered++;
  }

  // A sync that saw orders but stored none is a failure, not an empty book.
  if (failed && discovered === 0) {
    const e = new Error(`Every order failed to save: ${firstError}`);
    e.code = 500;
    throw e;
  }

  const { count } = await db.from('orders')
    .select('gg_order_id', { count: 'exact', head: true })
    .eq('partner_id', partnerId).eq('platform', PLATFORM);

  await db.from('partner_credentials').update({
    last_sync_at: new Date().toISOString(), orders_synced: count || 0, status: 'ok',
  }).eq('partner_id', partnerId).eq('platform', PLATFORM);

  await audit(db, {
    actor, partnerId, action: 'orders.sync', result: 'ok',
    detail: `${creds.environment}: ${discovered} discovered, ${count || 0} total`,
  });

  return { discovered, updated: discovered, missing: failed, checked: discovered + failed, total: count || 0 };
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
    await db.from('partner_credentials').update({ status: 'error' })
      .eq('partner_id', partnerId).eq('platform', PLATFORM);
    await audit(db, { actor: profile, partnerId, action: 'orders.sync', result: 'failed', detail: e.message });
    return json(res, e.code || 502, { error: e.message });
  }
}
