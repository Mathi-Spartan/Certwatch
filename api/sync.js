import { json, requireUser, partnerIdOf, audit } from './_lib/db.js';
import { gg, normaliseOrder } from './_lib/gg.js';
import { tss, normaliseTss } from './_lib/tss.js';
import { credsFor, tssCredsFor, refreshKnown } from './_lib/resolve.js';

/** GoGetSSL: V1 listing across accepted statuses, then per-order refresh. */
async function syncGoGetSSL(db, partnerId, actor) {
  const creds = await credsFor(db, partnerId);
  let discovered = 0;
  try {
    const list = await gg.listAll(creds.v1);
    for (const o of list) {
      const n = normaliseOrder(o);
      if (!n.gg_order_id) continue;
      discovered++;
      await db.from('orders').upsert({
        partner_id: partnerId, platform: 'gogetssl', ...n,
        source: 'sync', last_synced_at: new Date().toISOString(), last_status_at: new Date().toISOString(),
      }, { onConflict: 'partner_id,platform,gg_order_id' });
    }
  } catch (e) {
    await audit(db, { actor, partnerId, action: 'orders.discover', result: 'failed', detail: e.message });
  }
  const refreshed = await refreshKnown(db, partnerId, creds, { platform: 'gogetssl' });
  return { discovered, ...refreshed };
}

/**
 * TheSSLStore: one call returns the whole book, every status. No listing gap,
 * so no import workaround — this is a complete sync.
 */
async function syncTheSSLStore(db, partnerId, actor) {
  const creds = await tssCredsFor(db, partnerId);
  const list = await tss.listOrders(creds);
  let discovered = 0, failed = 0, firstError = null;
  for (const o of Array.isArray(list) ? list : []) {
    const n = normaliseTss(o);
    if (!n.gg_order_id) continue;
    const { error } = await db.from('orders').upsert({
      partner_id: partnerId, ...n,
      source: 'sync', api_linked: true,
      last_synced_at: new Date().toISOString(), last_status_at: new Date().toISOString(),
    }, { onConflict: 'partner_id,platform,gg_order_id' });
    if (error) { failed++; if (!firstError) firstError = error.message; }
    else discovered++;
  }
  // A sync that stored nothing but saw orders is a failure, not an empty book.
  if (failed && discovered === 0) {
    const e = new Error(`Every order failed to save: ${firstError}`);
    e.code = 500;
    throw e;
  }
  return { discovered, updated: discovered, missing: failed, checked: discovered + failed };
}

export async function syncPartner(db, partnerId, actor, platform = 'gogetssl') {
  const r = platform === 'thesslstore'
    ? await syncTheSSLStore(db, partnerId, actor)
    : await syncGoGetSSL(db, partnerId, actor);

  const { count } = await db.from('orders')
    .select('gg_order_id', { count: 'exact', head: true })
    .eq('partner_id', partnerId).eq('platform', platform);

  await db.from('partner_credentials').update({
    last_sync_at: new Date().toISOString(), orders_synced: count || 0, status: 'ok',
  }).eq('partner_id', partnerId).eq('platform', platform);

  await audit(db, {
    actor, partnerId, action: 'orders.sync', result: 'ok',
    detail: `${platform}: ${r.discovered} discovered, ${count || 0} total`,
  });
  return { ...r, total: count || 0, platform };
}

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  if (profile.role === 'sub_user') return json(res, 403, { error: 'Ask your partner to run a sync' });
  const partnerId = profile.role === 'admin' ? (req.query?.partner_id || null) : partnerIdOf(profile);
  if (!partnerId) return json(res, 400, { error: 'No partner account to sync' });

  const platform = req.query?.platform === 'thesslstore' ? 'thesslstore' : 'gogetssl';

  try {
    const r = await syncPartner(db, partnerId, profile, platform);
    return json(res, 200, { ok: true, ...r });
  } catch (e) {
    await db.from('partner_credentials').update({ status: 'error' })
      .eq('partner_id', partnerId).eq('platform', platform);
    await audit(db, { actor: profile, partnerId, action: 'orders.sync', result: 'failed', detail: `${platform}: ${e.message}` });
    return json(res, e.code || 502, { error: e.message });
  }
}
