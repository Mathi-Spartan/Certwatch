import { json, readBody, requireUser, ggKeyFor, audit } from './_lib/db.js';
import { gg } from './_lib/gg.js';

/**
 * Every certificate action a partner or sub-user can take.
 * Renewal is deliberately absent: it is the only action that spends the
 * partner's GoGetSSL balance, so it is not reachable from this portal at all.
 */
const ACTIONS = {
  reissue:        (k, id, p) => gg.reissue(k, id, {
                      csr: p.csr,
                      webserver_type: p.webserver_type,
                      dcv_method: p.dcv_method,
                      approver_emails: p.approver_emails,
                      dns_names: p.dns_names,
                    }),
  change_method:  (k, id, p) => gg.changeMethod(k, id, { domain: p.domain, new_method: p.new_method }),
  change_approver:(k, id, p) => gg.changeApprover(k, id, { domain: p.domain, new_email: p.new_email }),
  resend_approver:(k, id) => gg.resendApprover(k, id),
  revalidate:     (k, id) => gg.revalidate(k, id),
  cancel:         (k, id, p) => gg.cancel(k, id, p.reason),
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  const body = await readBody(req);
  const { action, order_id } = body;

  if (action === 'renew') {
    return json(res, 403, { error: 'Renewals are placed from the GoGetSSL account directly. This portal never spends a balance.' });
  }
  if (!ACTIONS[action]) return json(res, 400, { error: 'Unknown action' });
  if (!order_id) return json(res, 400, { error: 'Missing order' });

  // Ownership: partners act on their own book, sub-users only on assigned rows.
  let q = db.from('orders').select('*').eq('gg_order_id', String(order_id));
  if (profile.role === 'partner') q = q.eq('partner_id', profile.id);
  else if (profile.role === 'sub_user') q = q.eq('partner_id', profile.parent_partner_id).eq('assigned_to', profile.id);
  else return json(res, 403, { error: 'Administrators do not act on partner certificates' });

  const { data: row } = await q.maybeSingle();
  if (!row) return json(res, 404, { error: 'That certificate is not yours to manage' });

  try {
    const { key } = await ggKeyFor(db, row.partner_id);
    const out = await ACTIONS[action](key, row.gg_order_id, body);

    // Re-read so the screen reflects what the CA now believes.
    let fresh = null;
    try { fresh = await gg.orderStatus(key, row.gg_order_id); } catch { /* non-fatal */ }
    if (fresh) {
      await db.from('orders').update({ raw: fresh, gg_status: (fresh.status || '').toLowerCase(), last_synced_at: new Date().toISOString() })
        .eq('partner_id', row.partner_id).eq('gg_order_id', row.gg_order_id);
    }

    await audit(db, { actor: profile, partnerId: row.partner_id, action: `order.${action}`, orderId: row.gg_order_id, result: 'ok' });
    return json(res, 200, { ok: true, result: out, order: fresh });
  } catch (e) {
    await audit(db, { actor: profile, partnerId: row.partner_id, action: `order.${action}`, orderId: row.gg_order_id, result: 'failed', detail: e.message });
    return json(res, e.status || 502, { error: e.message });
  }
}
