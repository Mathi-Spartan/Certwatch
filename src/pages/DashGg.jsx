import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lifecycle, fmtTime } from '../lib/lifecycle.js';
import OrderDetail from '../components/OrderDetail.jsx';

/**
 * GoGetSSL dashboard — reconciliation-forward.
 *
 * GoGetSSL's book is never complete from sync alone: cancelled and automation
 * orders arrive by import, and some rows are read-only panel exports. So this
 * view leads with reconciliation state (synced vs imported vs export) and a
 * source breakdown, rather than pretending the book is whole.
 */
export default function DashGg({ data, orders, syncing, onSync, q, setQ, profile, onChanged }) {
  const [filter, setFilter] = useState('all');

  const counts = useMemo(() => {
    const active = orders.filter(o => o.gg_status === 'active').length;
    const cancelled = orders.filter(o => o.gg_status === 'cancelled').length;
    const expired = orders.filter(o => o.gg_status === 'expired').length;
    const other = orders.length - active - cancelled - expired;
    return { active, cancelled, expired, other, total: orders.length };
  }, [orders]);

  const filtered = useMemo(() => {
    let l = orders;
    if (filter === 'active') l = l.filter(o => o.gg_status === 'active');
    else if (filter === 'cancelled') l = l.filter(o => o.gg_status === 'cancelled');
    else if (filter === 'expired') l = l.filter(o => o.gg_status === 'expired');
    if (q.trim()) {
      const s = q.toLowerCase();
      l = l.filter(o => (o.common_name || '').toLowerCase().includes(s) ||
        (o.product_name || '').toLowerCase().includes(s) || String(o.gg_order_id).includes(s) ||
        (o.internal_id || '').toLowerCase().includes(s));
    }
    return l;
  }, [orders, filter, q]);

  return (
    <div className="gg-dash">
      <div className="gp-head">
        <div>
          <h1>Order book</h1>
          <p>Your whole GoGetSSL book — every order, every status, in one sync.</p>
        </div>
        <button className="btn btn-primary" onClick={onSync} disabled={syncing}>
          {syncing ? <><span className="spin" /> Syncing</> : 'Sync now'}
        </button>
      </div>

      {orders.length > 0 && (
        <div className="gg-complete">
          <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
          Complete book — {counts.total} orders synced in one call, every status included. Details load when you open an order.
        </div>
      )}

      {orders.length > 0 && (
        <div className="gg-stats">
          <div className="gg-stat"><div className="n mono">{counts.total}</div><div className="k">Total orders</div></div>
          <div className="gg-stat"><div className="n mono">{counts.active}</div><div className="k">Active</div></div>
          <div className="gg-stat"><div className="n mono">{counts.cancelled}</div><div className="k">Cancelled</div></div>
          <div className="gg-stat"><div className="n mono">{counts.expired}</div><div className="k">Expired</div></div>
        </div>
      )}

      {orders.length === 0 ? (
        <div className="empty">
          {data.connection?.connected ? (
            <>
              <h3>Connected, but this account has no orders</h3>
              <p style={{ maxWidth: '52ch', margin: '0 auto 16px' }}>
                We reached your account{data.connection.last_sync_at ? ` at ${fmtTime(data.connection.last_sync_at)}` : ''} and
                GoGetSSL returned an empty book. Every order — active, cancelled, expired — comes back in one
                call, so if orders exist they'll appear here.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={onSync} disabled={syncing}>{syncing ? 'Syncing' : 'Sync again'}</button>
                <Link className="btn" to="/connection">Check connection</Link>
              </div>
            </>
          ) : (
            <>
              <h3>Connect your GoGetSSL account</h3>
              <p>Save your API credentials and your order book appears here.</p>
              <Link className="btn btn-primary" to="/connection">Connect GoGetSSL</Link>
            </>
          )}
        </div>
      ) : (
        <div className="panel gg-panel">
          <div className="gg-ph">
            <h2>All orders</h2>
            <input className="gg-search" placeholder="Search domain, ID or product" value={q} onChange={e => setQ(e.target.value)} />
            <div className="gg-filters">
              {['all', 'active', 'cancelled', 'expired'].map(f => (
                <span key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
                </span>
              ))}
            </div>
          </div>
          {filtered.map(o => <GgRow key={o.gg_order_id} o={o} profile={profile} subusers={data.subusers || []} onChanged={onChanged} />)}
          {filtered.length === 0 && <div className="gg-row-empty">No orders match.</div>}
        </div>
      )}
    </div>
  );
}

function GgRow({ o, profile, subusers, onChanged }) {
  const [open, setOpen] = useState(false);
  const lc = lifecycle(o);
  const dead = ['cancelled', 'expired', 'rejected'].includes(o.gg_status);
  const tag = o.api_version === 'v2' ? 'v2' : 'v1';
  const tagLabel = o.api_version === 'v2' ? 'V2' : 'V1';
  const right = dead ? 'ended'
    : o.api_version === 'v2' ? (o.expires_at ? `renews ${new Date(o.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '—')
    : (lc && lc.toReissue != null ? `${lc.toReissue}d to reissue` : '—');

  return (
   <div className={`gg-rowwrap${open ? ' open' : ''}`}>
    <div className="gg-row" onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
      <span className="gg-domcell">
        <span className="gg-dom mono">{o.common_name || (o.enriched ? ('Order ' + o.gg_order_id) : <span className="gg-pending">Order {o.gg_order_id}</span>)}</span>
        <span className="gg-prod">{o.product_name || ''}</span>
        <span className={`gg-tag ${tag}`}>{tagLabel}</span>
      </span>
      <span><span className={`pill ${o.gg_status === 'active' ? 'act' : 'can'}`}>{o.gg_status === 'active' ? 'Active' : dead ? (o.gg_status[0].toUpperCase() + o.gg_status.slice(1)) : o.gg_status}</span></span>
      <span className="gg-id mono">{o.gg_order_id}</span>
      <span className="gg-right mut">{right} <span className="gg-caret">{open ? '▲' : '▼'}</span></span>
    </div>
    {open && (
      <div className="gg-detail" onClick={e => e.stopPropagation()}>
        <OrderDetail order={o} profile={profile} subusers={subusers} onChanged={onChanged} />
      </div>
    )}
   </div>
  );
}

const pctOf = (n, total) => (total ? Math.round((n / total) * 100) : 0);
