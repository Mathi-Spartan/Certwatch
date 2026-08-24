import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtTime } from '../lib/lifecycle.js';

export default function Activity({ profile }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    try { setD(await api('audit')); } catch (e) { setErr(e.message); }
  })(); }, []);

  return (
    <>
      <div className="gp-head"><div>
        <h1>Activity log</h1>
        <p>{profile.role === 'admin'
          ? 'Every call Certwatch made with a partner\u2019s credentials, and who triggered it.'
          : 'Everything done with your GoGetSSL credentials, by you and by your sub-users.'}</p>
      </div></div>

      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="loading"><span className="spin" /> Loading…</div>}

      {d && (d.entries.length === 0 ? (
        <div className="panel"><div className="empty"><h3>Nothing logged yet</h3><p>Actions appear here as they happen.</p></div></div>
      ) : (
        <div className="panel"><table className="tbl">
          <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 200 }}>Who</th><th>Action</th><th style={{ width: 110 }}>Order</th><th style={{ width: 90 }}>Result</th></tr></thead>
          <tbody>
            {d.entries.map(e => (
              <tr key={e.id}>
                <td className="mono" style={{ color: 'var(--muted)' }}>{fmtTime(e.created_at)}</td>
                <td>{e.actor_label || 'system'}</td>
                <td>{e.action}{e.detail ? <span style={{ color: 'var(--muted)' }}> — {e.detail}</span> : null}</td>
                <td className="mono">{e.gg_order_id || '—'}</td>
                <td><span className={`pill ${e.result === 'ok' ? 'ok' : 'bad'}`}>{e.result === 'ok' ? 'OK' : 'Failed'}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ))}
    </>
  );
}
