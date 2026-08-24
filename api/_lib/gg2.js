/**
 * GoGetSSL V2 partner API.
 *
 * V2 is a separate world from V1: different auth, different routes, and a
 * completely separate order book. An order placed through V2 is invisible to
 * V1 and vice versa — verified on partner 133617, where V1 answers
 * "Invalid order ID 3575662 for customer 133617" for an order V2 returns in
 * full. Certwatch therefore talks to both and merges the results.
 *
 * ID rules, mapped against live orders on partner 133617:
 *   /certificates/acme/{ORDER id}  -> resolves CaaS orders (acme and caas share
 *                                     a handler; the error text says "CAAS")
 *   /certificates/caas/{ITEM id}   -> resolves CaaS orders
 *   /certificates/ais/{ITEM id}    -> resolves AutoInstall orders
 * There is no order-id lookup for AIS, so an AutoInstall subscription can only
 * be imported by its item id. Order id alone is not enough for that one case.
 *
 * Auth:   Authorization: GGS {partner_code}:{api_password}
 * Reads:  GET /v2/certificates/{category}/{id}   category is ais | caas | acme
 *         There is NO collection endpoint. /certificates and every variant
 *         404s, and /certificates/{id}/{category} 404s while
 *         /certificates/{category}/{id} succeeds — so orders can only ever be
 *         fetched one at a time, by an id we already know.
 */
const BASE = 'https://my.gogetssl.com/api/v2';

export const CATEGORIES = ['acme', 'ais', 'caas'];

class GG2Error extends Error {
  constructor(msg, status, body) {
    super(msg);
    this.status = status;
    this.body = body;
  }
}

function header(partnerCode, password) {
  if (!partnerCode) throw new GG2Error('No partner code saved for this account', 409);
  return `GGS ${partnerCode}:${password}`;
}

async function call(path, { partnerCode, password, method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: header(partnerCode, password),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!res.ok) {
    throw new GG2Error(json.message || `V2 returned ${res.status}`, res.status, json);
  }
  return json;
}

export const gg2 = {
  /** Fetch one certificate. `id` is the order id for acme, the item id for ais/caas. */
  certificate: (creds, category, id) =>
    call(`/certificates/${category}/${id}`, creds),

  products: (creds) => call('/products', creds),

  /**
   * Try every category until one answers. Used when we know an id but not
   * which flavour of V2 product it belongs to — the common case on import.
   */
  async resolve(creds, id) {
    for (const category of CATEGORIES) {
      try {
        const data = await this.certificate(creds, category, id);
        if (data?.order?.id) return { category, data };
      } catch (e) {
        if (e.status && e.status !== 404) throw e; // a real fault, not "wrong category"
      }
    }
    return null;
  },
};

/** Product names are not in the order payload — only product_id. */
let productCache = { at: 0, byId: {} };
export async function productName(creds, productId) {
  if (!productId) return null;
  if (Date.now() - productCache.at > 60 * 60 * 1000) {
    try {
      const list = await gg2.products(creds);
      const byId = {};
      for (const p of Array.isArray(list) ? list : []) byId[String(p.id)] = p.label || p.name;
      productCache = { at: Date.now(), byId };
    } catch { /* fall back to the bare id below */ }
  }
  return productCache.byId[String(productId)] || `Product ${productId}`;
}

/**
 * Map a V2 payload onto our columns.
 *
 * V2 automation products are subscriptions, not fixed-term certificates: the
 * payload carries subscription.begin and subscription.next_renewal but no
 * certificate validity window. We deliberately leave valid_till null so the
 * lifecycle rail stays hidden rather than inventing a reissue countdown for a
 * product that renews itself.
 */
export async function normaliseV2(creds, category, data) {
  const order = data.order || {};
  const item = (data.items || [])[0] || {};
  const sub = item.subscription || {};
  const domains = Array.isArray(item.domains) ? item.domains : [];
  const firstDomain = domains.length
    ? (typeof domains[0] === 'string' ? domains[0] : domains[0].domain || domains[0].name)
    : null;

  return {
    gg_order_id: String(order.id),
    api_version: 'v2',
    gg_category: item.category || category,
    gg_item_id: item.id != null ? String(item.id) : null,
    common_name: firstDomain,
    product_name: await productName(creds, item.product_id),
    gg_status: (order.status || '').toLowerCase() || null,
    valid_from: sub.begin || (order.date ? String(order.date).slice(0, 10) : null),
    valid_till: null,
    expires_at: sub.next_renewal || null,
    raw: data,
  };
}

export { GG2Error };
