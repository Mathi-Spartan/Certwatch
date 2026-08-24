/** The two reseller platforms Certwatch spans. */
export const PLATFORMS = {
  gogetssl:    { id: 'gogetssl',    name: 'GoGetSSL',     tag: 'V1 + V2 reseller API', accent: '#3375b1' },
  thesslstore: { id: 'thesslstore', name: 'TheSSLStore',  tag: 'DigiCert-family REST API', accent: '#1f7a3d' },
};

const KEY = 'cw_platform';
export function getPlatform() {
  const v = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null;
  return v === 'thesslstore' ? 'thesslstore' : v === 'gogetssl' ? 'gogetssl' : null;
}
export function setPlatform(p) {
  try { sessionStorage.setItem(KEY, p); } catch {}
}
