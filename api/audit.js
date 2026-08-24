import { json, requireUser } from './_lib/db.js';

export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;

  let q = db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
  if (profile.role === 'partner') q = q.eq('partner_id', profile.id);
  else if (profile.role !== 'admin') return json(res, 403, { error: 'Not available for sub-users' });

  const { data, error } = await q;
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { entries: data || [] });
}
