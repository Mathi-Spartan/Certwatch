import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { lifecycle, fmtTime } from '../lib/lifecycle.js';
import OrderDetail from '../components/OrderDetail.jsx';

/**
 * TheSSLStore dashboard — lifecycle-forward.
 *
 * TheSSLStore returns the whole book in one sync, so this view is built around
 * a complete book ageing predictably: a "complete book" confirmation, a
 * lifecycle timeline, and rich per-order cards. It never talks about import,
 * because there is nothing to import here.
 */
export default function DashTss({ data, orders, syncing, onSync, q, setQ, profile, onChanged }) {
  const stats = useMemo(() => {
    const active = orders.filter(o => o.gg_status === 'active');
    const pending = orders.filter(o => o.gg_status === 'processing');
    const soon = active.filter(o => {
      const lc = lifecycle(o); return lc && lc.toReissue != null && lc.toReissue < 45;
    });
    return { total: orders.length, active: active.length, soon: soon.length, pending: pending.length };
  }, [orders]);

  const filtered = useMemo(() => {
    if (!q.trim()) return orders;
    const s = q.toLowerCase();
    return orders.filter(o =>
      (o.common_name || '').toLowerCase().includes(s) ||
      (o.product_name || '').toLowerCase().includes(s) ||
      String(o.gg_order_id).includes(s));
  }, [orders, q]);

  return (
    <div className="tss-dash">
      <div className="gp-head">
        <div>
          <h1>Certificate overview</h1>
          <p>Your entire order book, pulled in one sync — every status, always complete.</p>
        </div>
        <button className="btn btn-primary tss-btn" onClick={onSync} disabled={syncing}>
          {syncing ? <><span className="spin" /> Syncing</> : 'Sync now'}
        </button>
      </div>

      {orders.length > 0 && (
        <div className="tss-complete">
          <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
          Complete book — {orders.length} orders synced in one call
          {data.connection?.last_sync_at ? `, updated ${fmtTime(data.connection.last_sync_at)}` : ''}. Nothing to import.
        </div>
      )}

      <div className="tss-stats">
        <div className="tss-stat"><div className="n">{stats.total}</div><div className="k">Total orders</div></div>
        <div className="tss-stat"><div className="n">{stats.active}</div><div className="k">Active</div></div>
        <div className="tss-stat hot"><div className="n">{stats.soon}</div><div className="k">Reissue &lt; 45d</div></div>
        <div className="tss-stat"><div className="n">{stats.pending}</div><div className="k">Pending validation</div></div>
      </div>

      {orders.length === 0 ? (
        <div className="empty">
          {data.connection?.connected ? (
            <>
              <h3>Connected, but this account has no orders</h3>
              <p style={{ maxWidth: '52ch', margin: '0 auto 16px' }}>
                We reached your TheSSLStore account{data.connection.last_sync_at ? ` at ${fmtTime(data.connection.last_sync_at)}` : ''} and
                it returned an empty book. TheSSLStore lists every order in one call — cancelled included — so
                if orders exist they will appear here. Check you connected the right environment.
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
          <input className="tss-search" placeholder="Search domain, order ID or product"
                 value={q} onChange={e => setQ(e.target.value)} />
          <div className="tss-grid">
            {filtered.map(o => <TssCard key={o.gg_order_id} o={o} profile={profile} subusers={data.subusers || []} onChanged={onChanged} />)}
          </div>
        </>
      )}
    </div>
  );
}

function TssCard({ o, profile, subusers, onChanged }) {
  const [open, setOpen] = useState(false);
  const lc = lifecycle(o);
  const dead = ['cancelled', 'expired'].includes(o.gg_status);
  const pending = o.gg_status === 'processing';
  const pctElapsed = lc ? Math.round(((lc.total - lc.toOrderEnd) / lc.total) * 100) : null;
  const pct = pctElapsed != null ? Math.min(Math.max(pctElapsed, 2), 100) : (dead ? 100 : 4);
  const statusClass = o.gg_status === 'active' ? 'act' : pending ? 'pend' : 'can';
  const statusLabel = o.gg_status === 'active' ? 'Active' : pending ? 'Pending' : o.gg_status === 'expired' ? 'Expired' : 'Cancelled';

  // four-stage lane: ordered → validated → issued → live
  const stage = pending ? 1 : o.gg_status === 'active' ? 3 : dead ? 0 : 2;

  return (
    <div className={`tss-card${open ? ' open' : ''}`}>
      <div className="tc-head" onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
        <div>
          <div className="tc-dom mono">{o.common_name || o.product_name || 'Order ' + o.gg_order_id}</div>
          <div className="tc-prod">{o.product_name || '—'}</div>
        </div>
        <span className={`pill ${statusClass}`}>{statusLabel}</span>
      </div>
      <div className="tc-mini" style={dead ? { opacity: .35 } : undefined}>
        <i style={{ width: `${pct}%`, background: dead ? 'var(--muted)' : undefined }} />
      </div>
      <div className="tc-meta">
        <div><div className="k">Validity</div><div className="v">{o.valid_from ? `${fmtShort(o.valid_from)} → ${fmtShort(o.valid_till)}` : '—'}</div></div>
        <div><div className="k">{pending ? 'Stage' : 'Reissue in'}</div><div className="v" style={lc && lc.toReissue != null && lc.toReissue < 45 ? { color: 'var(--amber)' } : undefined}>{pending ? 'Validation' : lc && lc.toReissue != null && !dead ? `${lc.toReissue}d` : '—'}</div></div>
        <div><div className="k">Order</div><div className="v">{o.gg_order_id}</div></div>
      </div>
      <div className="tc-lane">
        {[0, 1, 2, 3].map(i => <div key={i} className={`lane${i < stage ? ' done' : i === stage && !dead ? ' now' : ''}`} />)}
      </div>
      <button className="tc-expand" onClick={() => setOpen(v => !v)}>{open ? 'Close' : 'Manage certificate'} {open ? '▲' : '▼'}</button>
      {open && (
        <div className="tc-detail" onClick={e => e.stopPropagation()}>
          <OrderDetail order={o} profile={profile} subusers={subusers} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function fmtShort(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
