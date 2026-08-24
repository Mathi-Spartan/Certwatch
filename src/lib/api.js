import { supabase } from './supabase.js';
import { getPlatform } from './platform.js';

/** Every call carries the caller's Supabase session so the server can scope it. */
export async function api(path, { method = 'GET', body, platform } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const plat = platform || getPlatform();
  const sep = path.includes('?') ? '&' : '?';
  const url = plat ? `/api/${path}${sep}platform=${plat}` : `/api/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text || 'Unexpected response' }; }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
