import { json, readBody, requireUser, partnerIdOf, audit } from './_lib/db.js';
import { credsFor, resolveOrder } from './_lib/resolve.js';

/**
 * Bring in orders that no listing endpoint will reveal.
 *
 * Cancelled V1 orders and every V2 order are invisible to bulk listing, so the
 * partner supplies the ids — pasted, or lifted from the GoGetSSL panel's
 * OrderDetail CSV export. Each id is resolved against V1 and then V2 and
 * stored with whatever status the CA reports.
 *
 * Ids are never guessed or scanned. GoGetSSL order ids are global across all
 * customers, so probing a range would mean touching other customers' orders.
 */
const MAX_IDS = 300;

/** Pull order ids out of a pasted list or a CSV export. */
function extractIds(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  // CSV with a header: find the column that looks like an order id.
  const header = lines[0].toLowerCase();
  if (header.includes(',') && /order\s*id|order_id|orderid/.test(header)) {
    const cols = lines[0].split(',').map(c => c.trim().toLowerCase().replace(/^"|"$/g, ''));
    const idx = cols.findIndex(c => /^order\s*id$|^order_id$|^orderid$/.test(c));
    if (idx >= 0) {
      return [...new Set(lines.slice(1)
        .map(l => (l.split(',')[idx] || '').trim().replace(/^"|"$/g, ''))
        .filter(v => /^\d+$/.test(v)))];
    }
  }
  // Otherwise: every number in the blob.
  return [...new Set(String(text).match(/\d{3,}/g) || [])];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;
  if (profile.role !== 'partner') return json(res, 403, { error: 'Only partners import orders' });

  const { text } = await readBody(req);
  const ids = extractIds(text);
  if (!ids.length) {
    return json(res, 400, { error: 'No order IDs found. Paste order numbers, or the CSV export from your GoGetSSL panel.' });
  }
  if (ids.length > MAX_IDS) {
    return json(res, 400, { error: `That is ${ids.length} IDs. Import up to ${MAX_IDS} at a time so the request does not time out.` });
  }

  const partnerId = partnerIdOf(profile);
  let creds;
  try { creds = await credsFor(db, partnerId); }
  catch (e) { return json(res, e.code || 502, { error: e.message }); }

  const imported = [];
  const notFound = [];

  for (const id of ids) {
    try {
      const found = await resolveOrder(creds, id);
      if (!found) { notFound.push(id); continue; }
      await db.from('orders').upsert({
        partner_id: partnerId,
        ...found,
        source: 'import',
        last_synced_at: new Date().toISOString(),
        last_status_at: new Date().toISOString(),
      }, { onConflict: 'partner_id,gg_order_id' });
      imported.push({ id: found.gg_order_id, api: found.api_version, status: found.gg_status });
    } catch (e) {
      notFound.push(id);
    }
  }

  const { count } = await db.from('orders')
    .select('gg_order_id', { count: 'exact', head: true })
    .eq('partner_id', partnerId);
  await db.from('partner_credentials').update({ orders_synced: count || 0 }).eq('partner_id', partnerId);

  await audit(db, {
    actor: profile, partnerId, action: 'orders.import', result: 'ok',
    detail: `${imported.length} of ${ids.length} resolved`,
  });

  return json(res, 200, {
    ok: true,
    hint: notFound.length
      ? 'IDs that did not resolve are either not on this account, or are AutoInstall subscriptions — those can only be looked up by their item ID, not their order ID.'
      : null,
    requested: ids.length,
    imported,
    not_found: notFound,
    v1: imported.filter(i => i.api === 'v1').length,
    v2: imported.filter(i => i.api === 'v2').length,
  });
}
