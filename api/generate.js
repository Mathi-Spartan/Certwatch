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

/**
 * Rebuild a CSR into canonical PEM before it goes to the CA.
 *
 * DigiCert answers "Failed to parse CSR. Generate CSR as valid Base-64 data"
 * for anything it cannot decode cleanly, and there are several ways to get
 * there: node-forge emits CRLF line endings, a paste from a terminal can carry
 * leading indentation or soft-wrapped lines, and copying out of a PDF can drop
 * the trailing newline. Rather than trust either source, we strip the body back
 * to raw base64, verify it decodes to a DER SEQUENCE, and re-emit it wrapped at
 * 64 columns with LF endings — the form every CA parser accepts.
 */
function canonicalCsr(input) {
  const text = String(input || '').replace(/\r/g, '');
  const m = text.match(/-----BEGIN (?:NEW )?CERTIFICATE REQUEST-----([\s\S]*?)-----END (?:NEW )?CERTIFICATE REQUEST-----/);
  if (!m) throw new Error('That does not look like a CSR. It must include the BEGIN and END CERTIFICATE REQUEST lines.');

  const b64 = m[1].replace(/[^A-Za-z0-9+/=]/g, '');
  if (!b64) throw new Error('The CSR is empty between its BEGIN and END lines.');

  let der;
  try { der = Buffer.from(b64, 'base64'); }
  catch { throw new Error('The CSR body is not valid Base-64.'); }

  // Re-encoding must round-trip, or the body held characters base64 silently
  // discarded — which is precisely what the CA reports as unparseable.
  if (der.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
    throw new Error('The CSR body is not valid Base-64 — it may have been truncated or line-wrapped by the copy.');
  }
  // 0x30 is DER SEQUENCE: every CSR starts with one.
  if (der.length < 64 || der[0] !== 0x30) {
    throw new Error('The CSR decodes but is not a certificate request. Check you pasted the CSR and not the private key or certificate.');
  }

  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE REQUEST-----\n${lines.join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
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

  const { csr, webserver_type, dcv_method, approver_email, dns_names, admin, tech, signature_hash } = body;
  let cleanCsr;
  try { cleanCsr = canonicalCsr(csr); }
  catch (e) { return json(res, 400, { error: e.message }); }

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

  const orderPayload = {
      TheSSLStoreOrderID: String(row.gg_order_id),
      DomainName: body.common_name || row.common_name || '',
      // The API expects the CSR URL-ENCODED, not as raw PEM. Their reference
      // payload calls this field {{csr_encoded}}. Raw PEM is rejected with
      // 'csr_invalid — Failed to parse CSR', which reads like a CSR problem
      // but is really an encoding one; base64 is rejected differently again
      // ('The CSR cannot be decoded!'). Verified against the sandbox: the
      // URL-encoded form is the one that succeeds.
      CSR: encodeURIComponent(cleanCsr),
      WebServerType: webserver_type || 'Other',
      // Required. Without it DigiCert receives an incomplete certificate object
      // and reports the whole request as 'csr_invalid — Failed to parse CSR',
      // which is misleading: the CSR is fine. Confirmed against the sandbox —
      // supplying this field replaces that error with a specific one.
      // CertCentral expects the lowercase form.
      SignatureHashAlgorithm: signature_hash || 'sha256',
      ProductCode: (row.raw && row.raw.ProductCode) || '',
      ValidityPeriod: (row.raw && row.raw.Validity) || 12,
      DNSNames: Array.isArray(dns_names) ? dns_names : [],
      ApproverEmail: approver_email || '',
      isCUOrder: false,
      isRenewalOrder: false,
      ServerCount: 1,
      SpecialInstructions: '',
      RelatedTheSSLStoreOrderID: '',
      // DCV selection on a NEW order is carried by these three booleans, not by
      // ApproverMethod — the OpenAPI NewOrderRequest schema has no such field,
      // which is why a bogus ApproverMethod was accepted without complaint: it
      // was simply ignored. All three false means email validation.
      // (ApproverMethod IS correct on /order/changeapprovermethod, which uses a
      // different schema.)
      FileAuthDVIndicator: dcv_method === 'http',
      HTTPSFileAuthDVIndicator: dcv_method === 'https',
      CNAMEAuthDVIndicator: dcv_method === 'cname',
      OrganizationInfo: {
        OrganizationName: (admin && admin.organization) || '',
        OrganizationAddress: {
          AddressLine1: (admin && admin.address) || '',
          City: (admin && admin.city) || '',
          Region: (admin && admin.region) || '',
          PostalCode: (admin && admin.postal_code) || '',
          Country: (admin && admin.country) || '',
          Phone: (admin && admin.phone) || '',
        },
      },
      AdminContact: contact(admin, approver_email),
      TechnicalContact: contact(tech || admin, approver_email),
  };

  try {
    // Dry run first. This API accepts bad values silently far too often, so a
    // rejection here is a readable error rather than a silently wrong order
    // placed against a real certificate.
    try {
      const v = await tss.validateOrder(creds, orderPayload);
      const vm = v?.AuthResponse?.Message;
      if (v?.AuthResponse?.isError) {
        return json(res, 400, { error: (vm && vm[0]) || 'TheSSLStore rejected these order details' });
      }
    } catch (e) {
      return json(res, 400, { error: e.message });
    }

    const out = await tss.completeInvite(creds, token, orderPayload);

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
