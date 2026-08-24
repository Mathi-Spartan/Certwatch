import { admin, json, audit } from './_lib/db.js';
import { syncPartner } from './sync.js';

/**
 * Daily sweep. Vercel calls this on the schedule in vercel.json.
 * Guarded by CRON_SECRET so it cannot be triggered by anyone who finds the URL.
 */
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.authorization?.replace('Bearer ', '') || req.query?.secret;
  if (!secret || given !== secret) return json(res, 401, { error: 'Not authorised' });

  const db = admin();
  const { data: creds } = await db.from('partner_credentials').select('partner_id');
  const results = [];

  for (const c of creds || []) {
    try {
      const n = await syncPartner(db, c.partner_id, { id: null, full_name: 'scheduled sync' });
      results.push({ partner_id: c.partner_id, orders: n });
    } catch (e) {
      await db.from('partner_credentials').update({ status: 'error' }).eq('partner_id', c.partner_id);
      await audit(db, { partnerId: c.partner_id, action: 'orders.sync', result: 'failed', detail: e.message });
      results.push({ partner_id: c.partner_id, error: e.message });
    }
  }
  return json(res, 200, { ok: true, partners: results.length, results });
}
