import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lifecycle, fmtTime } from '../lib/lifecycle.js';
import OrderDetail from '../components/OrderDetail.jsx';

/**
 * TheSSLStore order book — laid out the way the TheSSLStore panel lays it out,
 * so a partner can read both without translating between them.
 *
 * Columns match theirs: Date, Domain/Company, Order ID, Product, Price, Expire,
 * Status. Two details matter for that to line up:
 *
 *   1. Their "Order ID" is VendorOrderID, not TheSSLStoreOrderID. We show the
 *      vendor id as the headline and keep the TSS id beneath it, because the
 *      TSS id is what every API call is keyed on.
 *   2. Their "Incomplete" is our 'processing' / MajorStatus 'Pending' — an order
 *      bought but never taken through CSR and validation.
 *
 * Price and purchase date come straight from the stored payload; nothing extra
 * is fetched to render this.
 */

const CHIPS = [
  { id: 'all', label: 'All orders' },
  { id: 'active', label: 'Complete' },
  { id: 'initial', label: 'Incomplete' },
  { id: 'pending', label: 'Pending' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'expired', label: 'Expired' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** TheSSLStore dates arrive as "8/25/2026 6:20:49 AM"; 1/1/1900 is their null. */
function tssDate(v) {
  if (!v || String(v).startsWith('1/1/1900')) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
const fmtDate = (d) => (d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null);

function statusOf(o, certEnd) {
  const minor = (o.raw?.OrderStatus?.MinorStatus || '').toLowerCase();
  const major = (o.raw?.OrderStatus?.MajorStatus || '').toLowerCase();
  if (minor === 'revoked') return { key: 'cancelled', cls: 'can', label: 'Revoked' };

  // 'Initial' and 'Pending' both normalise to gg_status 'processing', but they
  // are completely different states and labelling both "Incomplete" hid the
  // fact that a submission had worked. Initial = bought, never configured.
  // Pending = CSR submitted, waiting on domain validation.
  if (o.gg_status === 'processing') {
    if (major === 'initial') return { key: 'initial', cls: 'pend', label: 'Incomplete' };
    return { key: 'pending', cls: 'proc', label: 'Pending validation' };
  }
  // TheSSLStore keeps reporting MajorStatus 'Active' after a certificate has
  // expired — their own panel derives expiry at display time from the end date,
  // so we do the same or an expired cert reads as Complete here.
  if (o.gg_status === 'active' && certEnd && certEnd < new Date()) {
    return { key: 'expired', cls: 'exp', label: 'Expired' };
  }
  switch (o.gg_status) {
    case 'active':     return { key: 'active', cls: 'act', label: 'Complete' };
    case 'expired':    return { key: 'expired', cls: 'exp', label: 'Expired' };
    case 'cancelled':  return { key: 'cancelled', cls: 'can', label: 'Cancelled' };
    default:           return { key: o.gg_status || 'unknown', cls: 'mute', label: o.gg_status || 'Unknown' };
  }
}

/** Relative time that ticks on its own, so "just now" does not go stale. */
function Ago({ at }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
  if (secs < 45) return <span>just now</span>;
  if (secs < 3600) return <span>{Math.round(secs / 60)} min ago</span>;
  return <span>{fmtTime(at)}</span>;
}

/** Sortable column header. The arrow shows direction only on the active column. */
function Th({ id, sort, on, right, children }) {
  const active = sort.col === id;
  return (
    <th className={`ob-th${right ? ' r' : ''}${active ? ' on' : ''}`}
        onClick={() => on(id)}
        title={`Sort by ${String(children).toLowerCase()}`}>
      {children}<span className="ob-arrow">{active ? (sort.dir === 'asc' ? '\u2191' : '\u2193') : '\u2195'}</span>
    </th>
  );
}

export default function DashTss({ data, orders, syncing, autoBusy, onSync, q, setQ, profile, onChanged }) {
  const [chip, setChip] = useState('all');
  const [open, setOpen] = useState(null);
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });

  function toggleSort(col) {
    setSort(s => s.col === col
      ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: col === 'status' || col === 'domain' ? 'asc' : 'desc' });
    setOpen(null);
  }

  const rows = useMemo(() => orders.map(o => {
    const raw = o.raw || {};
    const certEnd = tssDate(raw.CertificateEndDate) || (o.valid_till ? new Date(o.valid_till) : null);
    const st = statusOf(o, certEnd);
    const lc = lifecycle(o);
    return {
      o, raw, st, lc, certEnd,
      purchased: tssDate(raw.PurchaseDate),
      vendorId: raw.VendorOrderID || null,
      amount: raw.OrderAmount != null ? Number(raw.OrderAmount) : null,
      domain: o.common_name || raw.CommonName || raw.Organization || null,
      expiringSoon: st.key === 'active' && lc && lc.toReissue != null && lc.toReissue < 45,
    };
  }), [orders]);

  const counts = useMemo(() => ({
    all: rows.length,
    active: rows.filter(r => r.st.key === 'active').length,
    initial: rows.filter(r => r.st.key === 'initial').length,
    pending: rows.filter(r => r.st.key === 'pending').length,
    expiring: rows.filter(r => r.expiringSoon).length,
    expired: rows.filter(r => r.st.key === 'expired').length,
    cancelled: rows.filter(r => r.st.key === 'cancelled').length,
  }), [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (chip === 'expiring') list = list.filter(r => r.expiringSoon);
    else if (chip !== 'all') list = list.filter(r => r.st.key === chip);

    const s = q.trim().toLowerCase();
    if (s) list = list.filter(r =>
      (r.domain || '').toLowerCase().includes(s) ||
      (r.o.product_name || '').toLowerCase().includes(s) ||
      String(r.o.gg_order_id).includes(s) ||
      String(r.vendorId || '').includes(s));

    // Status sorts by where the order sits in its life, not alphabetically —
    // "Cancelled, Complete, Expired, Incomplete" would be a useless ordering.
    const RANK = { initial: 0, pending: 1, active: 2, expired: 3, cancelled: 4 };
    const val = (r) => {
      switch (sort.col) {
        case 'domain':  return (r.domain || '\uffff').toLowerCase();
        case 'order':   return Number(r.vendorId || r.o.gg_order_id || 0);
        case 'product': return (r.o.product_name || '').toLowerCase();
        case 'price':   return r.amount ?? -1;
        case 'expires': return r.certEnd?.getTime() ?? -1;
        case 'status':  return RANK[r.st.key] ?? 9;
        default:        return r.purchased?.getTime() ?? -1;
      }
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      // Stable tiebreak so equal keys never reshuffle between renders.
      return Number(b.o.gg_order_id) - Number(a.o.gg_order_id);
    });
  }, [rows, chip, q, sort]);

  return (
    <div className="tss-dash">
      <div className="gp-head">
        <div>
          <h1>Orders</h1>
          <p>Your entire TheSSLStore order book, pulled in one call — every status, always complete.</p>
        </div>
        <button className="btn btn-primary tss-btn" onClick={onSync} disabled={syncing}>
          {syncing ? <><span className="spin" /> Syncing</> : 'Sync now'}
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="empty">
          {data.connection?.connected ? (
            <>
              <h3>Connected, but this account has no orders</h3>
              <p style={{ maxWidth: '52ch', margin: '0 auto 16px' }}>
                We reached your TheSSLStore account{data.connection.last_sync_at ? ` at ${fmtTime(data.connection.last_sync_at)}` : ''} and
                it returned an empty book. Check you connected the right environment.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary tss-btn" onClick={onSync} disabled={syncing}>{syncing ? 'Syncing' : 'Sync again'}</button>
                <Link className="btn" to="/connection">Check connection</Link>
              </div>
            </>
          ) : (
            <>
              <h3>Connect your TheSSLStore account</h3>
              <p>Save your Partner Code and Auth Token, and your whole order book appears here.</p>
              <Link className="btn btn-primary tss-btn" to="/connection">Connect TheSSLStore</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="ob-bar">
            <div className="ob-chips">
              {CHIPS.map(c => (
                <button key={c.id}
                        className={`ob-chip${chip === c.id ? ' on' : ''}${c.id === 'expiring' && counts.expiring ? ' warn' : ''}`}
                        onClick={() => { setChip(c.id); setOpen(null); }}>
                  {c.label}<span className="n">{counts[c.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <input className="ob-search" placeholder="Search domain, order ID or product"
                   value={q} onChange={e => setQ(e.target.value)} />
          </div>

          {data.connection?.last_sync_at && (
            <div className="ob-synced">
              <span className={`ob-live${autoBusy ? ' on' : ''}`} />
              Keeping up to date automatically — {orders.length} orders, last checked <Ago at={data.connection.last_sync_at} />.
            </div>
          )}

          <div className="panel ob-panel">
            <table className="ob-tbl">
              <thead>
                <tr>
                  <Th id="date"    sort={sort} on={toggleSort}>Date</Th>
                  <Th id="domain"  sort={sort} on={toggleSort}>Domain / Company</Th>
                  <Th id="order"   sort={sort} on={toggleSort}>Order ID</Th>
                  <Th id="product" sort={sort} on={toggleSort}>Product</Th>
                  <Th id="price"   sort={sort} on={toggleSort} right>Price</Th>
                  <Th id="expires" sort={sort} on={toggleSort}>Expires</Th>
                  <Th id="status"  sort={sort} on={toggleSort}>Status</Th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="ob-none">Nothing matches that filter.</td></tr>
                )}
                {filtered.map(r => {
                  const id = r.o.gg_order_id;
                  const isOpen = open === id;
                  return [
                    <tr key={id} className={`ob-row${isOpen ? ' open' : ''}`} onClick={() => setOpen(isOpen ? null : id)}>
                      <td className="mono dim">{fmtDate(r.purchased) || '—'}</td>
                      <td>
                        {r.domain
                          ? <span className="ob-dom mono">{r.domain}</span>
                          : <span className="dim">—</span>}
                        {r.raw.SANCount > 0 && <span className="ob-san">+{r.raw.SANCount} SAN</span>}
                      </td>
                      <td>
                        <span className="mono">{r.vendorId || '—'}</span>
                        <span className="ob-sub mono">TSS {id}</span>
                      </td>
                      <td>
                        <span className="ob-prod">{r.o.product_name || r.raw.ProductName || '—'}</span>
                        {r.raw.SubVendorName && <span className="ob-sub">{r.raw.SubVendorName}</span>}
                      </td>
                      <td className="mono r">{r.amount != null ? `$${r.amount.toFixed(2)}` : '—'}</td>
                      <td className="mono dim">
                        {fmtDate(r.certEnd) || '—'}
                        {r.expiringSoon && <span className="ob-soon">{r.lc.toReissue}d</span>}
                      </td>
                      <td><span className={`pill ${r.st.cls}`}>{r.st.label}</span></td>
                      <td className="r"><span className="ob-caret">{isOpen ? '\u25B2' : '\u25BC'}</span></td>
                    </tr>,
                    isOpen && (
                      <tr key={id + '-d'} className="ob-detail-row">
                        <td colSpan={8}>
                          <div className="ob-detail" onClick={e => e.stopPropagation()}>
                            <OrderDetail order={r.o} profile={profile} subusers={data.subusers || []} onChanged={onChanged} />
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
