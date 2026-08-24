/**
 * The CA/Browser Forum maximum certificate lifetime, by the date the
 * certificate is issued. These are the dates the industry is working to.
 */
export function capOn(d) {
  if (d < new Date('2026-03-15')) return 398;
  if (d < new Date('2027-03-15')) return 200;
  if (d < new Date('2029-03-15')) return 100;
  return 47;
}

const DAY = 86400000;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysBetween = (a, b) => Math.round((b - a) / DAY);

/**
 * Break an order into the certificate that is live now plus every reissue
 * window it still has to absorb before the paid order period ends.
 */
export function lifecycle({ valid_from, valid_till, expires_at }) {
  const issued = valid_from ? new Date(valid_from) : null;
  const certEnd = valid_till ? new Date(valid_till) : null;
  const orderEnd = expires_at ? new Date(expires_at) : certEnd;
  if (!issued || !certEnd || !orderEnd) return null;

  const total = Math.max(daysBetween(issued, orderEnd), 1);
  const segs = [{ from: issued, to: certEnd, live: true }];
  let cur = certEnd, guard = 0;
  while (cur < orderEnd && guard++ < 80) {
    const next = addDays(cur, capOn(cur));
    const to = next > orderEnd ? orderEnd : next;
    segs.push({ from: cur, to, live: false });
    cur = to;
  }
  const now = new Date();
  return {
    segs, total, issued, certEnd, orderEnd,
    reissues: segs.length - 1,
    toReissue: daysBetween(now, certEnd),
    toOrderEnd: daysBetween(now, orderEnd),
  };
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sept','Oct','Nov','Dec'];
export function fmt(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '—';
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const STATUS = {
  active:     { t: 'Active',           c: 'ok',   dot: 'var(--green)' },
  processing: { t: 'Processing',       c: 'warn', dot: 'var(--amber)' },
  reissue:    { t: 'Reissue pending',  c: 'warn', dot: 'var(--amber)' },
  pending:    { t: 'Pending',          c: 'warn', dot: 'var(--amber)' },
  new_order:  { t: 'New order',        c: 'info', dot: 'var(--blue)' },
  incomplete: { t: 'Incomplete',       c: 'warn', dot: 'var(--amber)' },
  unpaid:     { t: 'Unpaid',           c: 'warn', dot: 'var(--amber)' },
  expired:    { t: 'Expired',          c: 'bad',  dot: 'var(--red)' },
  rejected:   { t: 'Rejected',         c: 'bad',  dot: 'var(--red)' },
  cancelled:  { t: 'Cancelled',        c: 'mute', dot: '#b9c2d0' },
};
export const statusOf = (s) => STATUS[s] || { t: s || 'Unknown', c: 'mute', dot: '#b9c2d0' };

/** getOrderStatus returns per-domain validation state as 0 / 1 / 2. */
export const DCV_STATE = {
  0: { t: 'Not started', c: 'mute' },
  1: { t: 'Processing',  c: 'warn' },
  2: { t: 'Validated',   c: 'ok' },
};

/** Pull the validation rows out of a getOrderStatus payload, whatever shape it takes. */
export function dcvRows(raw) {
  if (!raw) return [];
  const src = raw.validation || raw.san || raw.domains || raw.dcv || [];
  const arr = Array.isArray(src) ? src : Object.values(src);
  return arr.map(v => ({
    domain: v.san_name || v.domain || v.name || '—',
    method: v.validation_method || v.dcv_method || v.method || '—',
    approver: v.approver_email || v.validation_email || v.email || null,
    state: Number(v.status ?? 0),
    note: v.status_description || null,
  })).filter(r => r.domain !== '—');
}
