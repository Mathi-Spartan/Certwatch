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
    const v1 = orders.filter(o => o.api_version === 'v1' && o.api_linked !== false).length;
    const v2 = orders.filter(o => o.api_version === 'v2').length;
    const exp = orders.filter(o => o.api_linked === false).length;
    const synced = orders.filter(o => o.source === 'sync').length;
    const imported = orders.filter(o => o.source === 'import' || o.source === 'panel').length;
    return { v1, v2, exp, synced, imported, total: orders.length };
  }, [orders]);

  const filtered = useMemo(() => {
    let l = orders;
    if (filter === 'active') l = l.filter(o => o.gg_status === 'active');
    else if (filter === 'cancelled') l = l.filter(o => o.gg_status === 'cancelled');
    else if (filter === 'export') l = l.filter(o => o.api_linked === false);
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
          <p>Two APIs, one book. Cancelled and automation orders come in by import.</p>
        </div>
        <button className="btn btn-primary" onClick={onSync} disabled={syncing}>
          {syncing ? <><span className="spin" /> Syncing</> : 'Sync now'}
        </button>
      </div>

      {orders.length > 0 && (
        <div className="gg-recon">
          <div className="gr-big mono">{counts.total}</div>
          <div className="gr-x">
            <b>{counts.synced} synced · {counts.imported} imported</b>
            <p>GoGetSSL won't list cancelled or automation orders — those are brought in by ID. This is your reconciled book across both APIs and the panel export.</p>
            <div className="gr-bar">
              <i className="synced" style={{ width: `${pctOf(counts.synced, counts.total)}%` }} />
              <i className="imported" style={{ width: `${pctOf(counts.imported, counts.total)}%` }} />
            </div>
          </div>
          <Link className="btn ghost" to="/connection">Import by ID</Link>
        </div>
      )}

      <div className="gg-sources">
        <div className="gg-src"><div className="gs-t">V1 · Standard SSL<span className="gs-tag api">API</span></div><div className="gs-n mono">{counts.v1}</div><div className="gs-s">Listed &amp; refreshed</div></div>
        <div className="gg-src"><div className="gs-t">V2 · Automation<span className="gs-tag api">API</span></div><div className="gs-n mono">{counts.v2}</div><div className="gs-s">ACME &amp; AutoInstall</div></div>
        <div className="gg-src"><div className="gs-t">Panel export<span className="gs-tag csv">CSV</span></div><div className="gs-n mono">{counts.exp}</div><div className="gs-s">Cancelled, read-only</div></div>
      </div>

      {orders.length === 0 ? (
        <div className="empty">
          {data.connection?.connected ? (
            <>
              <h3>Connected, but nothing came back from a listing</h3>
              <p style={{ maxWidth: '52ch', margin: '0 auto 16px' }}>
                We reached your account{data.connection.last_sync_at ? ` at ${fmtTime(data.connection.last_sync_at)}` : ''} and
                GoGetSSL listed no orders. Cancelled orders and automation subscriptions never appear in a
                listing — bring them in once by ID, and they stay current after that.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <Link className="btn btn-primary" to="/connection">Import orders by ID</Link>
                <button className="btn" onClick={onSync} disabled={syncing}>{syncing ? 'Syncing' : 'Sync again'}</button>
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
              {['all', 'active', 'cancelled', 'export'].map(f => (
                <span key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'export' ? 'Export' : f[0].toUpperCase() + f.slice(1)}
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
  const isExport = o.api_linked === false;
  const tag = o.api_version === 'v2' ? 'v2' : isExport ? 'exp' : 'v1';
  const tagLabel = o.api_version === 'v2' ? 'V2' : isExport ? 'EXPORT' : 'V1';
  const right = dead ? 'ended'
    : o.api_version === 'v2' ? (o.expires_at ? `renews ${new Date(o.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '—')
    : (lc && lc.toReissue != null ? `${lc.toReissue}d to reissue` : '—');

  return (
   <div className={`gg-rowwrap${open ? ' open' : ''}`}>
    <div className="gg-row" onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer' }}>
      <span className="gg-domcell">
        <span className="gg-dom mono">{o.common_name || o.product_name || 'Order ' + o.gg_order_id}</span>
        <span className="gg-prod">{o.product_name || ''}</span>
        <span className={`gg-tag ${tag}`}>{tagLabel}</span>
      </span>
      <span><span className={`pill ${o.gg_status === 'active' ? 'act' : 'can'}`}>{o.gg_status === 'active' ? 'Active' : dead ? (o.gg_status[0].toUpperCase() + o.gg_status.slice(1)) : o.gg_status}</span></span>
      <span className={`gg-id mono${isExport ? ' mut' : ''}`}>{isExport ? o.internal_id : o.gg_order_id}</span>
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
