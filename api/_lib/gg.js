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
  listAllSsl:      { verb: 'GET',  path: '/orders/ssl/all/' }, // every order, all statuses, paginated
  batchStatuses:   { verb: 'POST', path: '/orders/statuses/' }, // status+expiry for many ids at once
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

/**
 * The statuses GET /orders/ will accept. Probed against the live API:
 * cancelled, incomplete, new_order, unpaid, pending and reissue are all
 * rejected with "Not supported status", so a cancelled V1 order can never be
 * discovered from a listing — only re-read by id once we already know it.
 */
/**
 * Historical note: the old `GET /orders?status=` filter refuses "cancelled"
 * (and several others) with "Not supported status", which is why this platform
 * once needed a CSV import to see cancelled orders at all. That workaround is
 * obsolete: `GET /orders/ssl/all` returns EVERY order in the account — active,
 * cancelled, expired, the lot — in one paginated call. Verified live against a
 * real account: 111 cancelled orders came back in a single request.
 *
 * The offset ceiling is 1000, so this pages 0..1000 (max 2000 orders). A book
 * larger than that would need GoGetSSL to lift the cap; we surface a warning
 * rather than silently truncate.
 */
export const V1_LIST_STATUSES = ['active', 'expired', 'processing', 'rejected']; // legacy fallback only

export const gg = {
  listOrders: (k) => call('GET', PATHS.listOrders.path, { authKey: k }),

  /**
   * Every order in the account, all statuses, via /orders/ssl/all.
   * Returns { orders, truncated } — orders carry only { order_id, status };
   * domain/dates are filled in lazily when an order is opened.
   */
  async listAll(k) {
    const byId = new Map();
    let offset = 0, truncated = false;
    for (let page = 0; page < 2; page++) {           // offset cap is 1000
      let r;
      try {
        r = await call('GET', `${PATHS.listAllSsl.path}?limit=1000&offset=${offset}`, { authKey: k });
      } catch (e) {
        // If /orders/ssl/all ever fails, fall back to the legacy status loop so
        // a sync still returns the listable orders rather than nothing.
        if (page === 0) return { orders: await legacyListAll.call(this, k), truncated: false };
        break;
      }
      const orders = r?.orders || [];
      for (const o of orders) byId.set(String(o.order_id ?? o.id), o);
      if (orders.length < 1000) break;               // last page
      offset += 1000;
      if (offset > 1000) { truncated = true; break; } // hit the API's offset ceiling
    }
    return { orders: [...byId.values()], truncated };
  },

  /** Batch status + expiry for many ids at once (cheap refresh, no per-order calls). */
  async batchStatuses(k, ids) {
    if (!ids?.length) return [];
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {       // keep each request modest
      const slice = ids.slice(i, i + 100);
      try {
        const r = await call('POST', PATHS.batchStatuses.path, { authKey: k, form: { cids: slice.join(',') } });
        for (const c of (r?.certificates || [])) out.push(c);
      } catch { /* a bad batch shouldn't sink the rest */ }
    }
    return out;
  },

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

/** Legacy multi-status listing, kept only as a fallback if /orders/ssl/all fails. */
async function legacyListAll(k) {
  const byId = new Map();
  const bare = await this.listOrders(k).catch(() => null);
  for (const o of (bare?.orders || [])) byId.set(String(o.order_id ?? o.id), o);
  for (const status of V1_LIST_STATUSES) {
    try {
      const r = await call('GET', `${PATHS.listOrders.path}?status=${status}`, { authKey: k });
      for (const o of (r?.orders || [])) byId.set(String(o.order_id ?? o.id), o);
    } catch { /* one status failing must not sink the whole sync */ }
  }
  return [...byId.values()];
}

/** Map a GoGetSSL order payload onto our columns. Unknown fields are kept raw. */
export function normaliseOrder(o) {
  const id = String(o.order_id ?? o.id ?? '');
  return {
    gg_order_id: id,
    api_version: 'v1',
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
