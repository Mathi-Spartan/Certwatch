import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import OrderList from '../components/OrderList.jsx';
import { lifecycle, dcvRows, fmtTime } from '../lib/lifecycle.js';
import { getPlatform, PLATFORMS } from '../lib/platform.js';

export default function Certificates({ profile }) {
  const platform = getPlatform() || 'gogetssl';
  const platName = PLATFORMS[platform].name;
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setErr('');
    try { setData(await api('orders')); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const orders = data?.orders || [];
  const subusers = data?.subusers || [];

  const shown = useMemo(() => {
    let l = orders;
    if (filter === 'action') l = l.filter(o => dcvRows(o.raw).some(r => r.state < 2) && !['cancelled', 'expired'].includes(o.gg_status));
    if (filter === 'active') l = l.filter(o => o.gg_status === 'active');
    if (filter === 'unassigned') l = l.filter(o => !o.assigned_to);
    if (q) l = l.filter(o => `${o.common_name} ${o.gg_order_id} ${o.product_name}`.toLowerCase().includes(q.toLowerCase()));
    return l;
  }, [orders, filter, q]);

  const active = orders.filter(o => o.gg_status === 'active');
  const needAction = orders.filter(o => dcvRows(o.raw).some(r => r.state < 2) && !['cancelled', 'expired'].includes(o.gg_status)).length;
  const soon = active.filter(o => { const l = lifecycle(o); return l && l.toReissue < 45; }).length;
  const next = active.map(o => lifecycle(o)?.toReissue).filter(n => typeof n === 'number').sort((a, b) => a - b)[0];

  async function sync() {
    setSyncing(true); setErr('');
    try { await api('sync', { method: 'POST', platform }); await load(); }
    catch (e) { setErr(e.message); }
    setSyncing(false);
  }

  return (
    <>
      <div className="gp-head">
        <div>
          <h1>{profile.role === 'sub_user' ? 'My certificates' : 'Certificates'}</h1>
          <p>{profile.role === 'sub_user'
            ? `Everything assigned to you, straight from your partner\u2019s ${platName} account.`
            : `Your full ${platName} order book, synced automatically. Expand a row to manage the certificate.`}</p>
        </div>
        {profile.role === 'partner' && (
          <div className="gp-head-actions">
            <button className="btn" onClick={sync} disabled={syncing}>
              {syncing ? <><span className="spin" /> Syncing</> : 'Sync now'}
            </button>
          </div>
        )}
      </div>

      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="loading"><span className="spin" /> Loading your certificates…</div>}

      {data && (
        <>
          <div className="stats">
            <div className={`stat${needAction ? ' act' : ''}`}><span className="n">{needAction}</span><span className="k">Waiting on validation</span></div>
            <div className="stat"><span className="n">{soon}</span><span className="k">Reissue due within 45 days</span></div>
            <div className="stat"><span className="n">{active.length}</span><span className="k">Active certificates</span></div>
            <div className="stat"><span className="n">{next != null ? `${next}d` : '—'}</span><span className="k">Until the next reissue</span></div>
          </div>

          <div className="filters">
            <input className="search" placeholder="Search domain, order ID or product" value={q} onChange={e => setQ(e.target.value)} />
            {[['all', 'All'], ['action', 'Needs attention'], ['active', 'Active'],
              ...(profile.role === 'partner' ? [['unassigned', 'Unassigned']] : [])].map(([k, l]) => (
              <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>

          {orders.length === 0 ? (
            <div className="panel"><div className="empty">
              {profile.role !== 'partner' ? (
                <>
                  <h3>No certificates yet</h3>
                  <p>Your partner has not assigned you any certificates yet.</p>
                </>
              ) : data.connection?.connected && platform === 'thesslstore' ? (
                <>
                  <h3>Connected, but this account has no orders</h3>
                  <p style={{ maxWidth: '52ch', margin: '0 auto 16px' }}>
                    We reached your {platName} account{data.connection.last_sync_at ? ` at ${fmtTime(data.connection.last_sync_at)}` : ''} and
                    it returned an empty order book. {platName} lists every order in one call — cancelled
                    included — so if orders exist they will appear here. Check you connected the right
                    environment and account.
                  </p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button className="btn btn-primary" onClick={sync} disabled={syncing}>
                      {syncing ? <><span className="spin" /> Syncing</> : 'Sync again'}
                    </button>
                    <Link className="btn" to="/connection">Check connection</Link>
                  </div>
                </>
              ) : data.connection?.connected ? (
                <>
                  <h3>Connected, but nothing came back from a listing</h3>
                  <p style={{ maxWidth: '52ch', margin: '0 auto 16px' }}>
                    We reached your account{data.connection.last_sync_at ? ` at ${fmtTime(data.connection.last_sync_at)}` : ''} and
                    GoGetSSL listed no orders. Two kinds of order never appear in a listing, no matter how
                    often you sync: <b>cancelled orders</b>, and <b>automation subscriptions</b> (ACME and
                    AutoInstall). Those have to be brought in once by ID — after that they stay up to date
                    on their own.
                  </p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <Link className="btn btn-primary" to="/connection">Import orders by ID</Link>
                    <button className="btn" onClick={sync} disabled={syncing}>
                      {syncing ? <><span className="spin" /> Syncing</> : 'Sync again'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3>No certificates yet</h3>
                  <p>Connect your GoGetSSL account and your whole order book appears here.</p>
                  <Link className="btn btn-primary" to="/connection">Connect GoGetSSL</Link>
                </>
              )}
            </div></div>
          ) : shown.length === 0 ? (
            <div className="panel"><div className="empty">
              <h3>Nothing matches that</h3><p>Clear the search or pick a different filter.</p>
              <button className="btn" onClick={() => { setQ(''); setFilter('all'); }}>Show all certificates</button>
            </div></div>
          ) : (
            <OrderList orders={shown} profile={profile} subusers={subusers} onChanged={load} />
          )}
        </>
      )}
    </>
  );
}
