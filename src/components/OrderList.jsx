import { useState } from 'react';
import Rail from './Rail.jsx';
import OrderDetail from './OrderDetail.jsx';
import { lifecycle, statusOf, dcvRows } from '../lib/lifecycle.js';

export default function OrderList({ orders, profile, subusers, onChanged }) {
  const [open, setOpen] = useState(null);

  return (
    <div className="rows">
      {orders.map(o => {
        const st = statusOf(o.gg_status);
        const lc = lifecycle(o);
        const dead = ['cancelled', 'expired', 'rejected'].includes(o.gg_status);
        const pending = dcvRows(o.raw).some(r => r.state < 2) && !dead;
        const sub = subusers?.find(s => s.id === o.assigned_to);
        const d = lc?.toReissue;
        const col = d == null || dead ? 'var(--muted)' : d < 30 ? 'var(--red)' : d < 60 ? 'var(--amber)' : 'var(--ink)';

        return (
          <div className={`row${open === o.gg_order_id ? ' open' : ''}`} key={o.gg_order_id}>
            <button className="row-hd" aria-expanded={open === o.gg_order_id}
              onClick={() => setOpen(open === o.gg_order_id ? null : o.gg_order_id)}>
              <span className="row-dot" style={{ background: st.dot }} />
              <span>
                <span className="row-cn mono">{o.common_name || '—'}</span>
                <span className="row-sub">{o.product_name || '—'}</span>
              </span>
              <span className="row-id mono hide-sm">
                {o.gg_order_id}
                <span className={`api-tag${o.api_version === 'v2' ? ' v2' : ''}`}>{o.api_version === 'v2' ? 'V2' : 'V1'}</span>
                {o.api_linked === false && <span className="api-tag" title="From your panel export — not linked to the API">EXPORT</span>}
              </span>
              <span className="hide-sm">
                <span className={`pill ${st.c}`}>{st.t}</span>
                {pending && <span className="pill warn plain" style={{ marginLeft: 4 }}>DCV</span>}
              </span>
              <span className="hide-sm" style={{ fontSize: 12, color: 'var(--muted)' }}>
                {profile.role === 'partner' ? (sub ? (sub.full_name || sub.email).split(' ')[0] : '—') : ''}
              </span>
              <span className="hide-sm">{lc ? <Rail order={o} micro /> : null}</span>
              <span className="row-days mono" style={{ color: col }}>
                {dead || d == null ? '—' : `${d}d`}
                <small>{o.api_version === 'v2' ? 'renews' : 'reissue'}</small>
              </span>
              <span className="row-chev">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
              </span>
            </button>
            <div className="row-body">
              {open === o.gg_order_id && (
                <OrderDetail order={o} profile={profile} subusers={subusers} onChanged={onChanged} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
