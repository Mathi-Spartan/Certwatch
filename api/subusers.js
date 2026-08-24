import { json, readBody, requireUser, audit, admin } from './_lib/db.js';

/** Partners create and remove their own sub-users. Admins do not. */
export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;
  if (profile.role !== 'partner') return json(res, 403, { error: 'Only partners manage sub-users' });

  if (req.method === 'GET') {
    const { data } = await db.from('profiles').select('id,full_name,email,created_at,status')
      .eq('parent_partner_id', profile.id).order('created_at');
    const { data: counts } = await db.from('orders').select('assigned_to').eq('partner_id', profile.id).not('assigned_to', 'is', null);
    const n = {};
    (counts || []).forEach(o => { n[o.assigned_to] = (n[o.assigned_to] || 0) + 1; });
    return json(res, 200, { subusers: (data || []).map(s => ({ ...s, assigned: n[s.id] || 0 })) });
  }

  if (req.method === 'POST') {
    const { email, full_name } = await readBody(req);
    if (!email || !full_name) return json(res, 400, { error: 'Name and email are both required' });

    const db2 = admin();
    const { data: created, error } = await db2.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      email_confirm: true,
      user_metadata: { full_name, role: 'sub_user', parent_partner_id: profile.id },
    });
    if (error) return json(res, 400, { error: error.message });

    await db2.from('profiles').upsert({
      id: created.user.id,
      email: created.user.email,
      full_name,
      role: 'sub_user',
      parent_partner_id: profile.id,
      status: 'active',
    }, { onConflict: 'id' });

    const site = process.env.PUBLIC_SITE_URL || '';
    let invite_link = null;
    try {
      const { data: link } = await db2.auth.admin.generateLink({
        type: 'recovery',
        email: created.user.email,
        options: site ? { redirectTo: `${site}/set-password` } : undefined,
      });
      invite_link = link?.properties?.action_link || null;
    } catch { /* best effort */ }

    await audit(db, { actor: profile, partnerId: profile.id, action: 'subuser.created', result: 'ok', detail: created.user.email });
    return json(res, 200, { ok: true, id: created.user.id, invite_link });
  }

  if (req.method === 'DELETE') {
    const { id } = await readBody(req);
    const { data: target } = await db.from('profiles').select('id,parent_partner_id,email').eq('id', id).maybeSingle();
    if (!target || target.parent_partner_id !== profile.id) return json(res, 404, { error: 'That is not one of your sub-users' });

    await db.from('orders').update({ assigned_to: null }).eq('partner_id', profile.id).eq('assigned_to', id);
    await admin().auth.admin.deleteUser(id);
    await audit(db, { actor: profile, partnerId: profile.id, action: 'subuser.removed', result: 'ok', detail: target.email });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
