import { json, readBody, requireUser, audit } from './_lib/db.js';

/** Partners assign a certificate to one of their sub-users, or take it back. */
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;
  if (profile.role !== 'partner') return json(res, 403, { error: 'Only partners assign certificates' });

  const { order_id, sub_user_id, platform } = await readBody(req);
  const plat = platform === 'thesslstore' ? 'thesslstore' : 'gogetssl';
  const { data: row } = await db.from('orders').select('gg_order_id')
    .eq('partner_id', profile.id).eq('platform', plat).eq('gg_order_id', String(order_id)).maybeSingle();
  if (!row) return json(res, 404, { error: 'That certificate is not in your book' });

  if (sub_user_id) {
    const { data: sub } = await db.from('profiles').select('id,parent_partner_id,full_name')
      .eq('id', sub_user_id).maybeSingle();
    if (!sub || sub.parent_partner_id !== profile.id) return json(res, 400, { error: 'That is not one of your sub-users' });
  }

  await db.from('orders').update({ assigned_to: sub_user_id || null, assigned_at: sub_user_id ? new Date().toISOString() : null })
    .eq('partner_id', profile.id).eq('platform', plat).eq('gg_order_id', String(order_id));

  await audit(db, { actor: profile, partnerId: profile.id, action: sub_user_id ? 'order.assigned' : 'order.unassigned', orderId: order_id, result: 'ok' });
  return json(res, 200, { ok: true });
}
