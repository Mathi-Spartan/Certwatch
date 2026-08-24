import { json, readBody, requireUser, partnerIdOf, audit } from './_lib/db.js';
import { credsFor, resolveOrder } from './_lib/resolve.js';

/**
 * Bring in orders that no API listing will reveal.
 *
 * Two input shapes, detected automatically:
 *
 *   1. The GoGetSSL panel CSV export (Id, Certificate status, Domain,
 *      Product name, Order number, ...). This is the only complete record of a
 *      cancelled book. Rows are stored from the CSV's own values and keyed by
 *      the "Order number" (S3574059), because none of the identifiers in the
 *      export are accepted by any API route — verified against the live API.
 *
 *   2. A list of numeric API order ids (or V2 item ids), which we resolve
 *      against both APIs and store as fully live rows.
 *
 * Batched: the caller sends a slice at a time and we report what is left, so a
 * book of any size imports without hitting the serverless timeout.
 */
const BATCH = 25;

function stripBom(s) { return String(s).replace(/^\uFEFF/, ''); }

/** Minimal CSV reader that copes with quoted fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = stripBom(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

function pick(obj, ...names) {
  for (const n of names) {
    const k = Object.keys(obj).find(key => key.trim().toLowerCase() === n.toLowerCase());
    if (k && obj[k] !== '') return obj[k];
  }
  return null;
}
const cleanDate = (v) => (v && !String(v).startsWith('0000') ? String(v).slice(0, 10) : null);

/** Turn the panel export into rows we can store. */
function rowsFromCsv(text) {
  const table = parseCsv(text);
  if (table.length < 2) return null;
  const header = table[0].map(h => stripBom(h).trim());
  const lower = header.map(h => h.toLowerCase());

  const looksLikePanelExport = lower.includes('certificate status') || lower.includes('order number');
  if (!looksLikePanelExport) return null;

  return table.slice(1).map(cells => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });

    const orderNumber = pick(obj, 'Order number', 'order_number');
    const panelId = pick(obj, 'Id');
    if (!orderNumber && !panelId) return null;

    const orderedAt = pick(obj, 'Order date');
    let ordered = null;
    if (orderedAt) {
      const d = new Date(orderedAt.replace(' ', 'T') + 'Z');
      if (!isNaN(d)) ordered = d.toISOString();
    }

    return {
      gg_order_id: orderNumber || `P${panelId}`,
      internal_id: orderNumber,
      panel_id: panelId,
      api_version: 'v1',
      api_linked: false,
      common_name: pick(obj, 'Domain'),
      product_name: pick(obj, 'Product name'),
      gg_status: (pick(obj, 'Certificate status') || '').toLowerCase() || null,
      valid_from: null,
      valid_till: cleanDate(pick(obj, 'Expiration date')),
      expires_at: cleanDate(pick(obj, 'Subscription end date')),
      price: pick(obj, 'Price'),
      ordered_at: ordered,
      source: 'panel',
      raw: obj,
    };
  }).filter(Boolean);
}

/** Any standalone number long enough to be an order or item id. */
function idsFromText(text) {
  return [...new Set(String(text).match(/\b\d{3,}\b/g) || [])];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;
  if (profile.role !== 'partner') return json(res, 403, { error: 'Only partners import orders' });

  const partnerId = partnerIdOf(profile);

  // Fail loudly and usefully if migration 003 has not been run yet.
  const probe = await db.from('orders').select('internal_id,api_linked').limit(1);
  if (probe.error) {
    return json(res, 503, {
      error: 'The database is missing the panel-import columns. Run db/003_panel_import.sql in the Supabase SQL editor, then try again.',
      detail: probe.error.message,
    });
  }

  const body = await readBody(req);
  const text = body.text;
  const offset = Number(body.offset) || 0;

  if (!text || !String(text).trim()) {
    return json(res, 400, { error: 'Nothing to import. Paste order IDs, or upload the CSV export from your GoGetSSL panel.' });
  }

  // ── CSV path ──────────────────────────────────────────────────────────
  const csvRows = rowsFromCsv(text);
  if (csvRows) {
    if (!csvRows.length) return json(res, 400, { error: 'That looks like the panel export but it has no rows in it.' });

    const slice = csvRows.slice(offset, offset + BATCH);
    let stored = 0;
    for (const row of slice) {
      // If the API already gave us this order, keep the live row and skip.
      const { data: live } = await db.from('orders')
        .select('gg_order_id')
        .eq('partner_id', partnerId)
        .eq('internal_id', row.internal_id)
        .eq('api_linked', true)
        .maybeSingle();
      if (live) continue;

      const { error } = await db.from('orders').upsert({
        partner_id: partnerId,
        ...row,
        last_synced_at: new Date().toISOString(),
        last_status_at: new Date().toISOString(),
      }, { onConflict: 'partner_id,gg_order_id' });
      if (!error) stored++;
    }

    const done = offset + slice.length;
    if (done >= csvRows.length) {
      const { count } = await db.from('orders').select('gg_order_id', { count: 'exact', head: true }).eq('partner_id', partnerId);
      await db.from('partner_credentials').update({ orders_synced: count || 0 }).eq('partner_id', partnerId);
      await audit(db, { actor: profile, partnerId, action: 'orders.import.csv', result: 'ok', detail: `${csvRows.length} rows from panel export` });
    }

    return json(res, 200, {
      ok: true, mode: 'csv',
      total: csvRows.length, done, stored,
      remaining: Math.max(csvRows.length - done, 0),
      next_offset: done < csvRows.length ? done : null,
    });
  }

  // ── ID path ───────────────────────────────────────────────────────────
  const ids = idsFromText(text);
  if (!ids.length) {
    return json(res, 400, { error: 'No order IDs found in that. Paste API order numbers, or upload the panel CSV export.' });
  }

  let creds;
  try { creds = await credsFor(db, partnerId); }
  catch (e) { return json(res, e.code || 502, { error: e.message }); }

  const slice = ids.slice(offset, offset + BATCH);
  const imported = [], notFound = [];

  for (const id of slice) {
    try {
      const found = await resolveOrder(creds, id);
      if (!found) { notFound.push(id); continue; }

      // An API row supersedes any CSV row for the same order.
      if (found.raw?.internal_id) {
        await db.from('orders').delete()
          .eq('partner_id', partnerId)
          .eq('internal_id', found.raw.internal_id)
          .eq('api_linked', false);
      }

      await db.from('orders').upsert({
        partner_id: partnerId,
        ...found,
        internal_id: found.raw?.internal_id || null,
        api_linked: true,
        source: 'import',
        last_synced_at: new Date().toISOString(),
        last_status_at: new Date().toISOString(),
      }, { onConflict: 'partner_id,gg_order_id' });
      imported.push({ id: found.gg_order_id, api: found.api_version, status: found.gg_status });
    } catch { notFound.push(id); }
  }

  const done = offset + slice.length;
  if (done >= ids.length) {
    const { count } = await db.from('orders').select('gg_order_id', { count: 'exact', head: true }).eq('partner_id', partnerId);
    await db.from('partner_credentials').update({ orders_synced: count || 0 }).eq('partner_id', partnerId);
    await audit(db, { actor: profile, partnerId, action: 'orders.import', result: 'ok', detail: `${ids.length} ids submitted` });
  }

  return json(res, 200, {
    ok: true, mode: 'ids',
    total: ids.length, done, imported, not_found: notFound,
    remaining: Math.max(ids.length - done, 0),
    next_offset: done < ids.length ? done : null,
    hint: notFound.length
      ? 'IDs that did not resolve are not API order numbers. The panel list shows a different reference (S…) — use the CSV export instead, or the API Order ID from an order detail page.'
      : null,
  });
}
