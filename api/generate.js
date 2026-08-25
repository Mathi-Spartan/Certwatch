import { json, readBody, requireUser, audit } from './_lib/db.js';
import { tss, normaliseTss, tssCredsFor } from './_lib/tss.js';

/**
 * Complete an order that was bought in the TheSSLStore dashboard but never
 * configured — what their panel calls "Incomplete" and drives with a green
 * "Generate Cert Now" button.
 *
 * How this is possible without spending anything: an unconfigured order carries
 * its own Token / TokenID / TokenCode. That token is a credential scoped to
 * exactly one order. Sent as AuthRequest.IsUsedForTokenSystem with the Token,
 * /order/neworder acts on THAT order and completes it, rather than placing a
 * new billable one. Verified against the sandbox: /order/status answers with
 * token-only auth and no partner credentials at all.
 *
 * The token never leaves the server. It is read from the row we already synced,
 * used for the call, and never returned to the browser — a customer completing
 * their own certificate never holds anything that reaches another order.
 */

/** Pull the per-order token out of a stored TheSSLStore payload. */
function tokenOf(raw = {}) {
  if (raw.Token) return raw.Token;
  // Their panel shows Token as "<TokenID>#!<TokenCode>"; rebuild it if the
  // combined field is absent but the two halves are present.
  if (raw.TokenID && raw.TokenCode) return `${raw.TokenID}#!${raw.TokenCode}`;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  const body = await readBody(req);
  const orderId = body.order_id;
  if (!orderId) return json(res, 400, { error: 'Missing order' });

  // Same scoping as every other action: partners see their own book, sub-users
  // only what has been assigned to them, admins act on nothing.
  let q = db.from('orders').select('*').eq('gg_order_id', String(orderId));
  if (profile.role === 'partner') q = q.eq('partner_id', profile.id);
  else if (profile.role === 'sub_user') q = q.eq('partner_id', profile.parent_partner_id).eq('assigned_to', profile.id);
  else return json(res, 403, { error: 'Administrators do not act on partner certificates' });

  const { data: row } = await q.maybeSingle();
  if (!row) return json(res, 404, { error: 'That certificate is not yours to manage' });

  // Assignment transfers the job. A partner who has handed an incomplete order
  // to a sub-user must not also be able to configure it, or the two race and
  // the second call fails against an order that is no longer incomplete.
  if (profile.role === 'partner' && row.assigned_to) {
    return json(res, 403, {
      error: 'This order is assigned to a sub-user, so they generate it. Unassign it first if you want to configure it yourself.',
    });
  }

  if (row.gg_status !== 'processing') {
    return json(res, 409, {
      error: 'Only an incomplete order can be generated. This one has already been configured.',
    });
  }

  const token = tokenOf(row.raw);
  if (!token) {
    return json(res, 409, {
      error: 'This order has no enrolment token, so it cannot be completed from here. Finish it in the TheSSLStore dashboard, or run a sync first in case the token arrived after this row was stored.',
    });
  }

  const { csr, webserver_type, dcv_method, approver_email, dns_names, admin, tech } = body;
  if (!csr || !String(csr).includes('CERTIFICATE REQUEST')) {
    return json(res, 400, { error: 'A valid CSR is required' });
  }

  // Credentials are still loaded — the environment (live vs sandbox) decides
  // which base URL the token is presented against.
  let creds;
  try { creds = await tssCredsFor(db, row.partner_id); }
  catch (e) { return json(res, e.code || 502, { error: e.message }); }

  const contact = (c = {}, fallbackEmail) => ({
    FirstName: c.first_name || '',
    LastName: c.last_name || '',
    Phone: c.phone || '',
    Email: c.email || fallbackEmail || '',
    Title: c.title || '',
    OrganizationName: c.organization || '',
    AddressLine1: c.address || '',
    City: c.city || '',
    Region: c.region || '',
    PostalCode: c.postal_code || '',
    Country: c.country || '',
  });

  try {
    const out = await tss.completeInvite(creds, token, {
      TheSSLStoreOrderID: String(row.gg_order_id),
      CSR: csr,
      WebServerType: webserver_type || 'Other',
      DNSNames: Array.isArray(dns_names) ? dns_names : [],
      ApproverEmail: approver_email || '',
      isCUOrder: false,
      isRenewalOrder: false,
      ServerCount: 1,
      SpecialInstructions: '',
      RelatedTheSSLStoreOrderID: '',
      // DCV: pick exactly one indicator, mirroring the panel's radio group.
      FileAuthDVIndicator: dcv_method === 'http',
      HTTPSFileAuthDVIndicator: dcv_method === 'https',
      CNAMEAuthDVIndicator: dcv_method === 'cname',
      AdminContact: contact(admin, approver_email),
      TechnicalContact: contact(tech || admin, approver_email),
    });

    // Re-read so the row reflects what TheSSLStore now believes, not what we hoped.
    let fresh = null;
    try {
      const o = await tss.orderStatus(creds, row.gg_order_id);
      fresh = normaliseTss({ ...o, TheSSLStoreOrderID: row.gg_order_id });
    } catch { /* the generate itself succeeded; a stale row is recoverable by sync */ }

    if (fresh) {
      await db.from('orders').update({
        ...fresh,
        last_synced_at: new Date().toISOString(),
        last_status_at: new Date().toISOString(),
      }).eq('partner_id', row.partner_id).eq('platform', 'thesslstore').eq('gg_order_id', row.gg_order_id);
    }

    await audit(db, {
      actor: profile, partnerId: row.partner_id, action: 'order.generate',
      orderId: row.gg_order_id, result: 'ok',
      detail: `${body.common_name || fresh?.common_name || 'certificate'} via ${dcv_method || 'email'}`,
    });

    return json(res, 200, { ok: true, result: out, status: fresh?.gg_status || null });
  } catch (e) {
    await audit(db, {
      actor: profile, partnerId: row.partner_id, action: 'order.generate',
      orderId: row.gg_order_id, result: 'failed', detail: e.message,
    });
    return json(res, 502, { error: e.message });
  }
}
