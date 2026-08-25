import { json, requireUser, audit, PLATFORM } from './_lib/db.js';
import { tss, tssCredsFor, normaliseTss } from './_lib/tss.js';

/** Rows the caller is allowed to see. */
function scope(db, profile) {
  const q = db.from('orders').select('*').eq('platform', PLATFORM);
  if (profile.role === 'admin') return q;
  if (profile.role === 'partner') return q.eq('partner_id', profile.id);
  return q.eq('partner_id', profile.parent_partner_id).eq('assigned_to', profile.id);
}

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  const id = req.query?.id;

  // Detail view — re-read from the CA so nothing on screen is stale.
  if (id) {
    const { data: row } = await scope(db, profile).eq('gg_order_id', String(id)).maybeSingle();
    if (!row) return json(res, 404, { error: 'That certificate is not yours to view' });

    try {
      const creds = await tssCredsFor(db, row.partner_id);
      const o = await tss.orderStatus(creds, row.gg_order_id);
      const fresh = normaliseTss({ ...o, TheSSLStoreOrderID: row.gg_order_id });
      const patch = { ...fresh, last_synced_at: new Date().toISOString(), last_status_at: new Date().toISOString() };
      await db.from('orders').update(patch)
        .eq('partner_id', row.partner_id).eq('platform', PLATFORM).eq('gg_order_id', row.gg_order_id);
      await audit(db, { actor: profile, partnerId: row.partner_id, action: 'order.view', orderId: row.gg_order_id });
      return json(res, 200, { ...row, ...patch, live: true });
    } catch (e) {
      // Fall back to the stored copy rather than showing the user nothing.
      return json(res, 200, { ...row, live: false, live_error: e.message });
    }
  }

  const { data, error } = await scope(db, profile).order('valid_till', { ascending: true, nullsFirst: false });
  if (error) return json(res, 500, { error: error.message });

  let subs = [];
  let connection = null;
  if (profile.role === 'partner') {
    const { data: s } = await db.from('profiles').select('id,full_name,email').eq('parent_partner_id', profile.id);
    subs = s || [];
    const { data: cred } = await db.from('partner_credentials')
      .select('status,last_sync_at,orders_synced,tss_environment')
      .eq('partner_id', profile.id).eq('platform', PLATFORM).maybeSingle();
    connection = cred
      ? { connected: true, status: cred.status, last_sync_at: cred.last_sync_at, orders_synced: cred.orders_synced, environment: cred.tss_environment || 'live' }
      : { connected: false };
  }
  return json(res, 200, { orders: data || [], subusers: subs, connection });
}
