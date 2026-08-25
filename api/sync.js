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

/**
 * Shortest gap between two automatic syncs of the same partner.
 *
 * Background syncs come from every open tab, and a partner may have several
 * plus their sub-users. Without a floor, ten tabs would mean ten calls to
 * TheSSLStore a minute for the same book. The throttle is enforced on the
 * server, where it sees every tab, rather than in the browser, which only sees
 * its own. A sync the user asks for explicitly is never throttled.
 */
const AUTO_SYNC_MIN_GAP_MS = 45_000;

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  // Background refresh, not a button press.
  const auto = req.query?.auto === '1';

  // A sub-user has no credentials of their own, but their view goes stale the
  // same way. Automatic refresh is allowed against their parent's book — it is
  // a read of orders they can already see, and the throttle applies. Pressing
  // Sync is still the partner's call.
  if (profile.role === 'sub_user' && !auto) {
    return json(res, 403, { error: 'Ask your partner to run a sync' });
  }

  const partnerId = profile.role === 'admin'
    ? (req.query?.partner_id || null)
    : partnerIdOf(profile);
  if (!partnerId) return json(res, 400, { error: 'No partner account to sync' });

  if (auto) {
    const { data: cred } = await db.from('partner_credentials')
      .select('last_sync_at').eq('partner_id', partnerId).eq('platform', PLATFORM).maybeSingle();
    if (!cred) return json(res, 200, { ok: true, skipped: 'not-connected' });
    const age = cred.last_sync_at ? Date.now() - new Date(cred.last_sync_at).getTime() : Infinity;
    if (age < AUTO_SYNC_MIN_GAP_MS) {
      return json(res, 200, { ok: true, skipped: 'throttled', age_ms: age });
    }
  }

  try {
    const r = await syncPartner(db, partnerId, profile);
    return json(res, 200, { ok: true, ...r });
  } catch (e) {
    // A background sync that fails is usually a transient network blip. Marking
    // the connection broken and writing an audit line for each one would fill
    // the log with noise and show the partner a scary state they cannot act on.
    // Explicit syncs still record both.
    if (!auto) {
      await db.from('partner_credentials').update({ status: 'error' })
        .eq('partner_id', partnerId).eq('platform', PLATFORM);
      await audit(db, { actor: profile, partnerId, action: 'orders.sync', result: 'failed', detail: e.message });
    }
    return json(res, e.code || 502, { error: e.message });
  }
}
