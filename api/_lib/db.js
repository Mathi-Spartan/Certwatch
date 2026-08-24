import { createClient } from '@supabase/supabase-js';
import { decrypt } from './crypto.js';
import { authenticate } from './gg.js';

export function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function json(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

/** Resolve the caller from their Supabase access token and load their profile. */
export async function requireUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { error: 'Sign in to continue', code: 401 };

  const db = admin();
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u?.user) return { error: 'Your session has expired', code: 401 };

  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('id', u.user.id)
    .single();

  if (!profile) return { error: 'No profile for this account', code: 403 };
  if (profile.status === 'disabled') return { error: 'This account has been disabled', code: 403 };
  return { user: u.user, profile, db };
}

export function requireRole(profile, ...roles) {
  return roles.includes(profile.role);
}

/**
 * The partner whose GoGetSSL account backs this caller.
 * Partners are their own partner; sub-users inherit their parent's.
 */
export function partnerIdOf(profile) {
  return profile.role === 'partner' ? profile.id : profile.parent_partner_id;
}

/**
 * Decrypt a partner's credentials and exchange them for a live GoGetSSL
 * session key. The plaintext password exists only inside this function call.
 */
export async function ggKeyFor(db, partnerId) {
  const { data: cred } = await db
    .from('partner_credentials')
    .select('*')
    .eq('partner_id', partnerId)
    .single();

  if (!cred) {
    const e = new Error('This partner has not connected a GoGetSSL account yet');
    e.code = 409;
    throw e;
  }

  // Reuse a cached session key while it is still fresh (GoGetSSL keys last ~3h).
  if (cred.auth_key && cred.auth_key_expires_at && new Date(cred.auth_key_expires_at) > new Date()) {
    return { key: cred.auth_key, cred };
  }

  const password = decrypt(cred.api_password_enc);
  const key = await authenticate(cred.gg_login, password);

  await db
    .from('partner_credentials')
    .update({
      auth_key: key,
      auth_key_expires_at: new Date(Date.now() + 150 * 60 * 1000).toISOString(),
      last_verified_at: new Date().toISOString(),
      status: 'ok',
    })
    .eq('partner_id', partnerId);

  return { key, cred };
}

/** Every call made with a partner's credentials leaves a trace. */
export async function audit(db, { actor, partnerId, action, orderId, result, detail }) {
  try {
    await db.from('audit_log').insert({
      actor_id: actor?.id || null,
      actor_label: actor?.full_name || actor?.email || 'system',
      partner_id: partnerId || null,
      action,
      gg_order_id: orderId ? String(orderId) : null,
      result: result || 'ok',
      detail: detail || null,
    });
  } catch {
    /* auditing must never break the request it is recording */
  }
}
