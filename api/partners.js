import { json, readBody, requireUser, audit, admin, PLATFORM } from './_lib/db.js';

/** Admin only: create and list partner accounts. */
export default async function handler(req, res) {
  const ctx = await requireUser(req);
  if (ctx.error) return json(res, ctx.code, { error: ctx.error });
  const { profile, db } = ctx;
  if (profile.role !== 'admin') return json(res, 403, { error: 'Administrators only' });

  if (req.method === 'GET') {
    const { data: partners } = await db.from('profiles').select('*').eq('role', 'partner').order('created_at');
    const { data: creds } = await db.from('partner_credentials').select('partner_id,status,last_sync_at,last_verified_at,orders_synced,tss_environment')
      .eq('platform', PLATFORM);
    const { data: subs } = await db.from('profiles').select('parent_partner_id').eq('role', 'sub_user');
    const byId = Object.fromEntries((creds || []).map(c => [c.partner_id, c]));
    const subCount = {};
    (subs || []).forEach(s => { subCount[s.parent_partner_id] = (subCount[s.parent_partner_id] || 0) + 1; });
    return json(res, 200, {
      partners: (partners || []).map(p => ({
        ...p,
        connection: byId[p.id] || null,
        sub_users: subCount[p.id] || 0,
      })),
    });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const first_name = String(body.first_name || '').trim();
    const last_name = String(body.last_name || '').trim();
    const company_name = String(body.company_name || '').trim() || null;
    const partner_code = String(body.partner_code || '').trim() || null;

    if (!first_name || !last_name) return json(res, 400, { error: 'First and last name are both required' });
    if (!email) return json(res, 400, { error: 'An email address is required' });
    if (!company_name) return json(res, 400, { error: 'A company name is required' });
    if (!partner_code) return json(res, 400, { error: 'A TheSSLStore Partner Code is required' });

    // full_name stays the display value every other screen already reads.
    const full_name = `${first_name} ${last_name}`;

    // A partner code identifies one TheSSLStore account — refuse a duplicate
    // here so the error is readable rather than a raw unique-index violation.
    const { data: clash } = await db.from('profiles')
      .select('id,email').eq('tss_partner_code', partner_code).maybeSingle();
    if (clash) return json(res, 409, { error: `Partner code ${partner_code} is already assigned to ${clash.email}` });

    const db2 = admin();
    const { data: created, error } = await db2.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name, first_name, last_name, company_name, role: 'partner', platform: PLATFORM },
    });
    if (error) return json(res, 400, { error: error.message });

    await db2.from('profiles').upsert({
      id: created.user.id,
      email: created.user.email,
      full_name,
      first_name,
      last_name,
      company_name,
      tss_partner_code: partner_code,
      role: 'partner',
      platform: PLATFORM,
      status: 'active',
    }, { onConflict: 'id' });

    // The partner sets their own password; we never pick one for them.
    const site = process.env.PUBLIC_SITE_URL || '';
    let invite_link = null;
    try {
      const { data: link } = await db2.auth.admin.generateLink({
        type: 'recovery',
        email: created.user.email,
        options: site ? { redirectTo: `${site}/set-password` } : undefined,
      });
      invite_link = link?.properties?.action_link || null;
    } catch { /* link generation is best effort */ }

    await audit(db, { actor: profile, partnerId: created.user.id, action: 'partner.created', result: 'ok', detail: created.user.email });
    return json(res, 200, { ok: true, partner_id: created.user.id, invite_link });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
