import { json, readBody, requireUser, audit, PLATFORM } from './_lib/db.js';
import { tss, tssCredsFor, normaliseTss } from './_lib/tss.js';

/**
 * Certificate actions against TheSSLStore.
 *
 * Renewal is deliberately absent. It is the only action that spends a
 * partner's balance, and this portal never does that.
 */
const ACTIONS = {
  reissue: (c, id, p) => tss.reissue(c, id, {
    csr: p.csr,
    webServerType: p.webserver_type,
    dnsNames: p.dns_names,
    approverEmail: p.approver_email,
  }),
  download:        (c, id) => tss.download(c, id),
  resend_approver: (c, id) => tss.resend(c, id, { resendType: 'ApproverEmail' }),
  change_approver: (c, id, p) => tss.changeApprover(c, id, {
    approverMethod: ({ email: 'EMAIL', http: 'FILE', https: 'FILE', cname: 'CNAME' })[p.new_method] || 'EMAIL',
    approverEmail: p.new_email,
    domainNames: p.domain,
  }),
  revoke: (c, id, p) => tss.revoke(c, id, p.reason),

  // Added from the OpenAPI spec — all verified to exist.
  refund:        (c, id, p) => tss.refund(c, id, p.reason),
  download_csr:  (c, id) => tss.downloadCsr(c, id),
  live_status:   (c, id) => tss.liveStatus(c, id),
  order_info:    (c, id) => tss.orderInfo(c, id),
  check_dcv:     (c, id, p) => tss.checkDcv(c, id, p.domain),
  approver_list: (c, id, p) => tss.approverList(c, p.domain, p.product_code),
  add_san:       (c, id, p) => tss.addSan(c, id, { san: p.san_count, wildcard: p.wildcard_count }),
};

/** Actions that only read — they should not re-sync or write an order row. */
const READ_ONLY = new Set(['download', 'download_csr', 'order_info', 'approver_list', 'check_dcv']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  const body = await readBody(req);
  const { action, order_id } = body;

  if (action === 'renew') {
    return json(res, 403, { error: 'Renewals are placed from TheSSLStore directly. This portal never spends a balance.' });
  }
  if (!order_id) return json(res, 400, { error: 'Missing order' });

  let q = db.from('orders').select('*')
    .eq('platform', PLATFORM).eq('gg_order_id', String(order_id));
  if (profile.role === 'partner') q = q.eq('partner_id', profile.id);
  else if (profile.role === 'sub_user') q = q.eq('partner_id', profile.parent_partner_id).eq('assigned_to', profile.id);
  else return json(res, 403, { error: 'Administrators do not act on partner certificates' });

  const { data: row } = await q.maybeSingle();
  if (!row) return json(res, 404, { error: 'That certificate is not yours to manage' });

  const fn = ACTIONS[action];
  if (!fn) return json(res, 400, { error: 'That action is not available for this certificate' });

  try {
    const creds = await tssCredsFor(db, row.partner_id);
    const out = await fn(creds, row.gg_order_id, body);

    // Re-read so the screen shows what the CA now believes, not what we hoped.
    let fresh = null;
    if (!READ_ONLY.has(action)) {
      try {
        const o = await tss.orderStatus(creds, row.gg_order_id);
        fresh = normaliseTss({ ...o, TheSSLStoreOrderID: row.gg_order_id });
      } catch { /* the action still succeeded; the refresh is best effort */ }
      if (fresh) {
        await db.from('orders').update({
          ...fresh,
          last_synced_at: new Date().toISOString(),
          last_status_at: new Date().toISOString(),
        }).eq('partner_id', row.partner_id).eq('platform', PLATFORM).eq('gg_order_id', row.gg_order_id);
      }
    }

    await audit(db, { actor: profile, partnerId: row.partner_id, action: `order.${action}`, orderId: row.gg_order_id, result: 'ok' });
    return json(res, 200, { ok: true, result: out, order: fresh?.raw || null, status: fresh?.gg_status || null });
  } catch (e) {
    await audit(db, { actor: profile, partnerId: row.partner_id, action: `order.${action}`, orderId: row.gg_order_id, result: 'failed', detail: e.message });
    return json(res, e.code || 502, { error: e.message });
  }
}
