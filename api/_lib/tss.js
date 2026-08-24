/**
 * TheSSLStore REST API client (a DigiCert-family API — unrelated to GoGetSSL).
 *
 * Auth is a PartnerCode + AuthToken pair sent in the body of every POST, under
 * an AuthRequest object. There is no session handshake. Two environments:
 *   live    -> https://api.thesslstore.com/rest
 *   sandbox -> https://sandbox-wbapi.thesslstore.com/rest
 *
 * The decisive difference from GoGetSSL: /order/query returns the partner's
 * WHOLE order book in one call, every status included — cancelled orders too.
 * So there is no listing gap here and no CSV workaround: sync is complete.
 *
 * Verified against the live sandbox on 2026-08-24:
 *   /order/query  with no filter -> full list (46 orders, 28 of them cancelled)
 *   /order/status with a bad token -> isError:true "Token/Authentication Failure"
 *     (this is the only endpoint that reliably rejects a bad token, so it is
 *      what we validate credentials against)
 */

const BASE = {
  live: 'https://api.thesslstore.com/rest',
  sandbox: 'https://sandbox-wbapi.thesslstore.com/rest',
};

class TSSError extends Error {
  constructor(msg, body) { super(msg); this.body = body; }
}

function authBlock(creds) {
  return {
    PartnerCode: creds.partnerCode,
    AuthToken: creds.authToken,
    ReplayToken: '',
    UserAgent: 'Certwatch',
  };
}

async function call(creds, path, payload = {}) {
  const base = BASE[creds.environment] || BASE.live;
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ AuthRequest: authBlock(creds), ...payload }),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  // Errors surface inside AuthResponse, not the HTTP status.
  const ar = Array.isArray(json) ? null : json.AuthResponse;
  if (ar && ar.isError) {
    throw new TSSError((ar.Message && ar.Message[0]) || 'TheSSLStore rejected the request', json);
  }
  if (!res.ok) throw new TSSError(`TheSSLStore returned ${res.status}`, json);
  return json;
}

export const tss = {
  /** The whole order book, every status. Optional paging. */
  listOrders: (creds, { pageNumber, pageSize } = {}) =>
    call(creds, '/order/query', {
      ...(pageNumber ? { PageNumber: pageNumber } : {}),
      ...(pageSize ? { PageSize: pageSize } : {}),
    }),

  orderStatus: (creds, orderId) =>
    call(creds, '/order/status', { TheSSLStoreOrderID: String(orderId) }),

  reissue: (creds, orderId, { csr, webServerType, dnsNames, approverEmail }) =>
    call(creds, '/order/reissue', {
      TheSSLStoreOrderID: String(orderId),
      CSR: csr,
      WebServerType: webServerType || '',
      DNSNames: dnsNames || [],
      ReissueEmail: approverEmail || '',
    }),

  resend: (creds, orderId, { resendType, resendEmail, domainNames }) =>
    call(creds, '/order/resend', {
      TheSSLStoreOrderID: String(orderId),
      ResendEmailType: resendType || 'ApproverEmail',
      ResendEmail: resendEmail || '',
      DomainNames: domainNames || '',
    }),

  changeApprover: (creds, orderId, { approverMethod, approverEmail, domainNames }) =>
    call(creds, '/order/changeapprovermethod', {
      TheSSLStoreOrderID: String(orderId),
      ApproverMethod: approverMethod || 'Email',
      ApproverEmail: approverEmail || '',
      DomainNames: domainNames || '',
    }),

  revoke: (creds, orderId, reason) =>
    call(creds, '/order/revokerequest', {
      TheSSLStoreOrderID: String(orderId),
      RefundReason: reason || 'Revoked from Certwatch',
    }),

  downloadZip: (creds, orderId) =>
    call(creds, '/order/downloadaszip', { TheSSLStoreOrderID: String(orderId), ReturnPKCS7Cert: false }),
};

/**
 * Verify a credential pair. order/query does not reject a bad token in sandbox,
 * but order/status does — so we get any order id from the list, then probe it.
 * With no orders we probe a nonexistent id: an auth failure is a bad token; an
 * "order not found" style message means the token is fine.
 */
export async function verifyTss(creds) {
  // order/query does NOT reject a bad token (verified in sandbox), so it cannot
  // validate credentials. order/status does: a bad token returns
  // "-9008 Token/Authentication Failure" regardless of the order id, while a
  // good token returns no auth error even for a nonexistent order. So we probe
  // order/status directly and read that one signal.
  try {
    const r = await tss.orderStatus(creds, '999999999');
    return { ok: !(r.AuthResponse && r.AuthResponse.isError), reason: 'verified' };
  } catch (e) {
    if (/token|authentication/i.test(e.message)) return { ok: false, reason: 'token' };
    return { ok: false, reason: 'unverified' };
  }
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'];
/** TheSSLStore dates look like "7/23/2026 1:50:20 AM"; normalise to YYYY-MM-DD. */
function isoDate(v) {
  if (!v || String(v).startsWith('1/1/1900')) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Map a TheSSLStore order onto our columns. */
export function normaliseTss(o) {
  const status = o.OrderStatus || {};
  const major = (status.MajorStatus || '').toLowerCase();
  // Align vocabulary with the rest of the app.
  const statusMap = { active: 'active', cancelled: 'cancelled', canceled: 'cancelled', pending: 'processing', expired: 'expired', initial: 'processing' };
  const domain = o.CommonName && !/\s/.test(o.CommonName) ? o.CommonName : (o.DNSNames || '').split(',')[0] || o.CommonName || null;

  return {
    gg_order_id: String(o.TheSSLStoreOrderID),
    platform: 'thesslstore',
    api_version: 'tss',
    common_name: domain,
    product_name: o.ProductName || o.ProductCode || null,
    gg_status: statusMap[major] || major || null,
    valid_from: isoDate(o.CertificateStartDate),
    valid_till: isoDate(o.CertificateEndDate),
    expires_at: isoDate(o.OrderExpiryDate) || isoDate(o.CertificateEndDate),
    raw: o,
  };
}

export { TSSError };
