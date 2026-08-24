import { json, requireUser, partnerIdOf, platformFor, audit } from './_lib/db.js';
import { gg } from './_lib/gg.js';
import { tss, normaliseTss } from './_lib/tss.js';
import { credsFor, tssCredsFor } from './_lib/resolve.js';

/**
 * GoGetSSL: one listing call now returns the ENTIRE book — every status,
 * cancelled included — via /orders/ssl/all. We store each order lightweight
 * (id + status) on sync and enrich it with domain/dates lazily, the first time
 * someone opens it. That keeps sync fast no matter how large the book is, and
 * removes the old CSV-import workaround for cancelled orders entirely.
 */
async function syncGoGetSSL(db, partnerId, actor) {
  const creds = await credsFor(db, partnerId);
  let discovered = 0, truncated = false;
  try {
    const { orders, truncated: cut } = await gg.listAll(creds.v1);
    truncated = cut;

    // Cheap batch refresh: statuses + expiry for active certs, no per-order calls.
    const ids = orders.map(o => String(o.order_id ?? o.id)).filter(Boolean);
    const statusMap = new Map();
    const batch = await gg.batchStatuses(creds.v1, ids).catch(() => []);
    for (const c of batch) statusMap.set(String(c.order_id), c);

    // Preserve any detail we already enriched on a previous open, so re-syncing
    // a known order doesn't wipe its domain/dates back to null.
    const { data: existing } = await db.from('orders')
      .select('gg_order_id, common_name, valid_from, valid_till, expires_at, raw, enriched')
      .eq('partner_id', partnerId).eq('platform', 'gogetssl');
    const known = new Map((existing || []).map(r => [r.gg_order_id, r]));

    for (const o of orders) {
      const id = String(o.order_id ?? o.id);
      if (!id) continue;
      discovered++;
      const prev = known.get(id);
      const batched = statusMap.get(id);
      const status = (batched?.status || o.status || '').toLowerCase() || null;
      const row = {
        partner_id: partnerId, platform: 'gogetssl', gg_order_id: id,
        api_version: 'v1', gg_status: status,
        source: 'sync', api_linked: true,
        // keep enriched detail if we have it; otherwise leave null until opened
        common_name: prev?.common_name ?? null,
        valid_from: prev?.valid_from ?? null,
        valid_till: prev?.valid_till ?? null,
        expires_at: (batched?.expires && batched.expires !== '0000-00-00' ? batched.expires : prev?.expires_at) ?? null,
        enriched: prev?.enriched ?? false,
        last_synced_at: new Date().toISOString(), last_status_at: new Date().toISOString(),
      };
      await db.from('orders').upsert(row, { onConflict: 'partner_id,platform,gg_order_id' });
    }
  } catch (e) {
    await audit(db, { actor, partnerId, action: 'orders.discover', result: 'failed', detail: e.message });
  }
  return { discovered, truncated, updated: discovered, missing: 0, checked: discovered };
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

  const platform = platformFor(profile, req.query?.platform) || 'gogetssl';

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
