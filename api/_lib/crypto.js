import crypto from 'crypto';

/**
 * Partner GoGetSSL API passwords are encrypted with AES-256-GCM before they
 * touch the database. The key lives only in the CRED_ENC_KEY env var, so a
 * database dump on its own is useless — an attacker needs the Vercel env too.
 *
 * CRED_ENC_KEY must be 64 hex characters (32 bytes).
 */
function key() {
  const k = process.env.CRED_ENC_KEY;
  if (!k || !/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('CRED_ENC_KEY missing or not 64 hex characters');
  }
  return Buffer.from(k, 'hex');
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  // iv:tag:ciphertext — all base64, single column
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(blob) {
  const [ivB, tagB, encB] = String(blob).split(':');
  if (!ivB || !tagB || !encB) throw new Error('Stored credential is malformed');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  d.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
}

/** Never render a credential — show its shape only. */
export function maskLogin(login) {
  const s = String(login || '');
  if (s.length <= 3) return '•'.repeat(s.length);
  return s.slice(0, 2) + '•'.repeat(Math.max(s.length - 4, 3)) + s.slice(-2);
}
