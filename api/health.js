import { json } from './_lib/db.js';

export default async function handler(req, res) {
  return json(res, 200, {
    ok: true,
    service: 'certwatch',
    supabase_url_set: !!process.env.SUPABASE_URL,
    service_role_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    enc_key_valid: /^[0-9a-fA-F]{64}$/.test(process.env.CRED_ENC_KEY || ''),
    cron_secret_set: !!process.env.CRON_SECRET,
    time: new Date().toISOString(),
  });
}
