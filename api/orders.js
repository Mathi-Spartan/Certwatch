import { json, requireUser, ggKeyFor, audit } from './_lib/db.js';
import { gg } from './_lib/gg.js';

/** Rows the caller is allowed to see. */
function scope(db, profile, platform) {
  let q = db.from('orders').select('*');
  if (platform) q = q.eq('platform', platform);
  if (profile.role === 'admin') return q;
  if (profile.role === 'partner') return q.eq('partner_id', profile.id);
  return q.eq('partner_id', profile.parent_partner_id).eq('assigned_to', profile.id);
}

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  const id = req.query?.id;
  const platform = req.query?.platform === 'thesslstore' ? 'thesslstore' : (req.query?.platform === 'gogetssl' ? 'gogetssl' : null);

  // Detail view — always re-read from the CA so nothing on screen is stale.
  if (id) {
    const { data: row } = await scope(db, profile, platform).eq('gg_order_id', String(id)).maybeSingle();
    if (!row) return json(res, 404, { error: 'That certificate is not yours to view' });

    if (row.platform === 'thesslstore') {
      // A tss detail view is served from the stored row; sync keeps it fresh.
      return json(res, 200, { ...row, live: false });
    }
    try {
      const { key } = await ggKeyFor(db, row.partner_id);
      const fresh = await gg.orderStatus(key, row.gg_order_id);
      await db.from('orders').update({ raw: fresh, gg_status: (fresh.status || '').toLowerCase() || row.gg_status, last_synced_at: new Date().toISOString() })
        .eq('partner_id', row.partner_id).eq('gg_order_id', row.gg_order_id);
      await audit(db, { actor: profile, partnerId: row.partner_id, action: 'order.view', orderId: row.gg_order_id });
      return json(res, 200, { ...row, raw: fresh, live: true });
    } catch (e) {
      // Fall back to the stored copy rather than showing the user nothing.
      return json(res, 200, { ...row, live: false, live_error: e.message });
    }
  }

  const { data, error } = await scope(db, profile, platform).order('valid_till', { ascending: true, nullsFirst: false });
  if (error) return json(res, 500, { error: error.message });

  let subs = [];
  let connection = null;
  if (profile.role === 'partner') {
    const { data: s } = await db.from('profiles').select('id,full_name,email').eq('parent_partner_id', profile.id);
    subs = s || [];
    const { data: creds } = await db.from('partner_credentials')
      .select('platform,status,last_sync_at,orders_synced').eq('partner_id', profile.id);
    const forPlatform = (creds || []).find(c => c.platform === (platform || 'gogetssl'));
    connection = forPlatform
      ? { connected: true, status: forPlatform.status, last_sync_at: forPlatform.last_sync_at, orders_synced: forPlatform.orders_synced }
      : { connected: false };
  }
  return json(res, 200, { orders: data || [], subusers: subs, connection, platform: platform || 'gogetssl' });
}
