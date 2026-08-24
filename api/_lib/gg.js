/**
 * GoGetSSL V1 API client.
 *
 * Every path below was verified against the live API on 2026-08-24 by probing
 * with a deliberately invalid auth key. The API distinguishes the two failures:
 *   403 {"message":"Auth key is not valid"}      -> the path exists
 *   404 {"message":"The requested method..."}    -> the path does not exist
 * Note that POST-only endpoints answer 404 to a GET, so each was probed with
 * its real verb.
 *
 * NOT wired anywhere in this codebase, deliberately: addSSLOrder,
 * addSSLRenewOrder, addSSLSANOrder. This portal can never spend a partner's
 * balance, so a compromise of it cannot cost a partner money.
 */
const BASE = 'https://my.gogetssl.com/api';

export const PATHS = {
  auth:            { verb: 'POST', path: '/auth/' },
  listOrders:      { verb: 'GET',  path: '/orders/' },
  orderStatus:     { verb: 'GET',  path: (id) => `/orders/status/${id}/` },
  balance:         { verb: 'GET',  path: '/account/balance/' },
  reissue:         { verb: 'POST', path: (id) => `/orders/ssl/reissue/${id}/` },
  changeMethod:    { verb: 'POST', path: (id) => `/orders/ssl/change_validation_method/${id}/` },
  changeApprover:  { verb: 'POST', path: (id) => `/orders/ssl/change_validation_email/${id}/` },
  resendApprover:  { verb: 'POST', path: (id) => `/orders/ssl/resend_validation_email/${id}/` },
  revalidate:      { verb: 'POST', path: (id) => `/orders/ssl/revalidate/${id}/` },
  cancel:          { verb: 'POST', path: '/orders/cancel_ssl_order/' }, // order id goes in the BODY
};

class GGError extends Error {
  constructor(msg, status, body) {
    super(msg);
    this.status = status;
    this.body = body;
  }
}

async function call(verb, path, { authKey, form } = {}) {
  const url = new URL(BASE + path);
  if (authKey) url.searchParams.set('auth_key', authKey);

  const init = { method: verb, headers: {} };
  if (verb === 'POST') {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form || {})) {
      if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
    }
    init.body = body;
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (json && json.error) {
    throw new GGError(json.message || json.description || 'GoGetSSL rejected the request', res.status, json);
  }
  if (!res.ok) {
    throw new GGError(`GoGetSSL returned ${res.status}`, res.status, json);
  }
  return json;
}

/**
 * Exchange login + API password for a session key.
 * Field names are `user` and `pass` — not `login`/`password`.
 */
export async function authenticate(login, apiPassword) {
  const r = await call('POST', PATHS.auth.path, { form: { user: login, pass: apiPassword } });
  if (!r.key) {
    throw new GGError(r.message || 'GoGetSSL did not return a session key', 401, r);
  }
  return r.key;
}

export const gg = {
  listOrders: (k) => call('GET', PATHS.listOrders.path, { authKey: k }),
  orderStatus: (k, id) => call('GET', PATHS.orderStatus.path(id), { authKey: k }),
  balance: (k) => call('GET', PATHS.balance.path, { authKey: k }),

  reissue: (k, id, form) => call('POST', PATHS.reissue.path(id), { authKey: k, form }),
  changeMethod: (k, id, form) => call('POST', PATHS.changeMethod.path(id), { authKey: k, form }),
  changeApprover: (k, id, form) => call('POST', PATHS.changeApprover.path(id), { authKey: k, form }),
  resendApprover: (k, id) => call('POST', PATHS.resendApprover.path(id), { authKey: k, form: {} }),
  revalidate: (k, id) => call('POST', PATHS.revalidate.path(id), { authKey: k, form: {} }),
  cancel: (k, id, reason) =>
    call('POST', PATHS.cancel.path, { authKey: k, form: { order_id: id, reason: reason || 'Cancelled from Certwatch' } }),
};

/** Map a GoGetSSL order payload onto our columns. Unknown fields are kept raw. */
export function normaliseOrder(o) {
  const id = String(o.order_id ?? o.id ?? '');
  return {
    gg_order_id: id,
    common_name: o.domain || o.common_name || null,
    product_name: o.product_name || o.product || null,
    gg_status: (o.status || '').toLowerCase() || null,
    valid_from: o.valid_from && o.valid_from !== '0000-00-00' ? o.valid_from : null,
    valid_till: o.valid_till && o.valid_till !== '0000-00-00' ? o.valid_till : null,
    expires_at: o.expires && o.expires !== '0000-00-00' ? o.expires : null,
    raw: o,
  };
}

export { GGError };
