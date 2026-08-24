import { json, admin } from './_lib/db.js';

/**
 * Bootstrap the Master Admin from environment configuration.
 *
 * The master admin is defined by MASTER_ADMIN_EMAIL rather than a hand-edited
 * database row, so a fresh deployment provisions its own administrator without
 * anyone touching the database. This endpoint is safe to call repeatedly: it
 * promotes the configured email if it exists and is not already admin, and does
 * nothing otherwise. It never creates a second admin and never demotes anyone.
 *
 * Guarded by BOOTSTRAP_SECRET so it cannot be triggered by the public.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const secret = req.headers['x-bootstrap-secret'];
  if (!process.env.BOOTSTRAP_SECRET || secret !== process.env.BOOTSTRAP_SECRET) {
    return json(res, 403, { error: 'Forbidden' });
  }

  const email = (process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return json(res, 500, { error: 'MASTER_ADMIN_EMAIL is not set' });

  const db = admin();

  // Find the auth user with that email.
  const { data: list, error: listErr } = await db.auth.admin.listUsers();
  if (listErr) return json(res, 502, { error: listErr.message });
  const user = (list?.users || []).find(u => (u.email || '').toLowerCase() === email);
  if (!user) {
    return json(res, 404, {
      error: `No account exists for ${email} yet. Create it first (sign up or invite), then call this again.`,
    });
  }

  // Promote their profile to admin if it is not already.
  const { data: prof } = await db.from('profiles').select('id,role').eq('id', user.id).maybeSingle();
  if (!prof) {
    await db.from('profiles').insert({ id: user.id, email, role: 'admin', full_name: 'Master Admin' });
    return json(res, 200, { ok: true, action: 'created', email });
  }
  if (prof.role !== 'admin') {
    await db.from('profiles').update({ role: 'admin' }).eq('id', user.id);
    return json(res, 200, { ok: true, action: 'promoted', email });
  }
  return json(res, 200, { ok: true, action: 'already_admin', email });
}
