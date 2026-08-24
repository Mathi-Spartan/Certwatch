import { json, readBody, requireUser, audit } from './_lib/db.js';
import { gg } from './_lib/gg.js';
import { credsFor, resolveOrder } from './_lib/resolve.js';

/**
 * Certificate actions, routed by the API the order actually lives in.
 *
 * The two APIs do not offer the same operations, and pretending otherwise
 * would give people buttons that always fail. V1 orders are conventional
 * certificates: reissue, validation control, cancel. V2 orders are automation
 * subscriptions (ACME / AutoInstall) where issuance and renewal are driven by
 * the customer's own client — there is nothing to reissue and no approver
 * email to resend, so those actions are reported as not applicable rather
 * than attempted.
 *
 * Renewal is absent from both maps. It is the only action that spends a
 * partner's balance, and this portal never does that.
 */
const V1_ACTIONS = {
  reissue:         (c, id, p) => gg.reissue(c.v1, id, {
                      csr: p.csr, webserver_type: p.webserver_type, dcv_method: p.dcv_method,
                      approver_emails: p.approver_emails, dns_names: p.dns_names,
                   }),
  change_method:   (c, id, p) => gg.changeMethod(c.v1, id, { domain: p.domain, new_method: p.new_method }),
  change_approver: (c, id, p) => gg.changeApprover(c.v1, id, { domain: p.domain, new_email: p.new_email }),
  resend_approver: (c, id) => gg.resendApprover(c.v1, id),
  revalidate:      (c, id) => gg.revalidate(c.v1, id),
  cancel:          (c, id, p) => gg.cancel(c.v1, id, p.reason),
};

/** What a V2 order supports, and why the rest does not apply. */
const V2_UNAVAILABLE = {
  reissue: 'This is an automation subscription. Certificates are issued and reissued by your ACME client or the AutoInstall agent, not from here.',
  change_method: 'Domain validation for automation products is handled by the ACME client or agent.',
  change_approver: 'Automation products do not use approver emails.',
  resend_approver: 'Automation products do not use approver emails.',
  revalidate: 'Validation for automation products is driven by your ACME client or agent.',
};

async function v2Cancel(creds, row) {
  // V2 cancellation is a DELETE on the category route. acme keys on the order
  // id, ais and caas on the item id.
  const category = row.gg_category || 'acme';
  const id = category === 'acme' ? row.gg_order_id : (row.gg_item_id || row.gg_order_id);
  const res = await fetch(`https://my.gogetssl.com/api/v2/certificates/${category}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `GGS ${creds.v2.partnerCode}:${creds.v2.password}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GoGetSSL refused the cancellation (${res.status}) ${t.slice(0, 120)}`);
  }
  return { cancelled: true };
}

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
  if (!order_id) return json(res, 400, { error: 'Missing order' });

  let q = db.from('orders').select('*').eq('gg_order_id', String(order_id));
  if (profile.role === 'partner') q = q.eq('partner_id', profile.id);
  else if (profile.role === 'sub_user') q = q.eq('partner_id', profile.parent_partner_id).eq('assigned_to', profile.id);
  else return json(res, 403, { error: 'Administrators do not act on partner certificates' });

  const { data: row } = await q.maybeSingle();
  if (!row) return json(res, 404, { error: 'That certificate is not yours to manage' });

  const isV2 = row.api_version === 'v2';
  if (isV2 && V2_UNAVAILABLE[action]) {
    return json(res, 409, { error: V2_UNAVAILABLE[action], not_applicable: true });
  }
  if (!isV2 && !V1_ACTIONS[action]) return json(res, 400, { error: 'Unknown action' });

  try {
    const creds = await credsFor(db, row.partner_id);

    let out;
    if (isV2) {
      if (action !== 'cancel') return json(res, 400, { error: 'Unknown action for this product' });
      out = await v2Cancel(creds, row);
    } else {
      out = await V1_ACTIONS[action](creds, row.gg_order_id, body);
    }

    // Re-read so the screen shows what the CA now believes, not what we hoped.
    const fresh = await resolveOrder(creds, row.gg_order_id, row).catch(() => null);
    if (fresh) {
      await db.from('orders').update({
        ...fresh,
        last_synced_at: new Date().toISOString(),
        last_status_at: new Date().toISOString(),
      }).eq('partner_id', row.partner_id).eq('gg_order_id', row.gg_order_id);
    }

    await audit(db, { actor: profile, partnerId: row.partner_id, action: `order.${action}`, orderId: row.gg_order_id, result: 'ok' });
    return json(res, 200, { ok: true, result: out, order: fresh?.raw || null, status: fresh?.gg_status || null });
  } catch (e) {
    await audit(db, { actor: profile, partnerId: row.partner_id, action: `order.${action}`, orderId: row.gg_order_id, result: 'failed', detail: e.message });
    return json(res, e.status || 502, { error: e.message });
  }
}
