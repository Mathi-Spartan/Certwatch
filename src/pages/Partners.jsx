import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import { fmtTime } from '../lib/lifecycle.js';

const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export default function Partners() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(false);
  const [invite, setInvite] = useState(null);

  async function load() {
    try { setD(await api('partners')); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  const list = d?.partners || [];
  const connected = list.filter(p => p.connection).length;
  const errored = list.filter(p => p.connection?.status === 'error').length;
  const totalOrders = list.reduce((n, p) => n + (p.connection?.orders_synced || 0), 0);

  return (
    <>
      <div className="gp-head">
        <div>
          <h1>Partners</h1>
          <p>Each partner connects their own GoGetSSL and/or TheSSLStore account. You create the login — they hold the credentials.</p>
        </div>
        <div className="gp-head-actions"><button className="btn btn-primary" onClick={() => setModal(true)}>Add partner</button></div>
      </div>

      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="loading"><span className="spin" /> Loading partners…</div>}

      {d && <>
        <div className="stats">
          <div className="stat"><span className="n">{list.length}</span><span className="k">Partners</span></div>
          <div className="stat"><span className="n">{connected}</span><span className="k">Accounts connected</span></div>
          <div className={`stat${errored ? ' act' : ''}`}><span className="n">{errored}</span><span className="k">Connections failing</span></div>
          <div className="stat"><span className="n">{totalOrders}</span><span className="k">Certificates under management</span></div>
        </div>

        {list.length === 0 ? (
          <div className="panel"><div className="empty">
            <h3>No partners yet</h3><p>Add the first one and send them their invite link.</p>
            <button className="btn btn-primary" onClick={() => setModal(true)}>Add partner</button>
          </div></div>
        ) : (
          <div className="panel"><table className="tbl">
            <thead><tr><th>Partner</th><th>Platform</th><th>Contact email</th><th>Connection</th><th>Orders</th><th>Sub-users</th><th>Last sync</th></tr></thead>
            <tbody>
              {list.map(p => {
                const c = p.connection;
                const pill = !c ? ['mute', 'Awaiting credentials'] : c.status === 'error' ? ['bad', 'Rejected'] : ['ok', 'Connected'];
                return (
                  <tr key={p.id}>
                    <td><div className="who">
                      <span className="av">{initials(p.company_name || p.full_name)}</span>
                      <span><b>{p.company_name || p.full_name}</b><span>{p.full_name}</span></span>
                    </div></td>
                    <td>{p.platform
                      ? <span className={`ptag ${p.platform === 'thesslstore' ? 'tss' : 'gg'}`}>{p.platform === 'thesslstore' ? 'TheSSLStore' : 'GoGetSSL'}</span>
                      : <span className="mut">—</span>}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{p.email}</td>
                    <td><span className={`pill ${pill[0]}`}>{pill[1]}</span></td>
                    <td className="mono">{c?.orders_synced ?? '—'}</td>
                    <td className="mono">{p.sub_users || '—'}</td>
                    <td className="mono" style={{ color: 'var(--muted)' }}>{c?.last_sync_at ? fmtTime(c.last_sync_at) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}

        <div className="callout" style={{ marginTop: 18, maxWidth: 'none' }}>
          <b>You never see a partner's API password.</b> It is encrypted the moment it is saved and only ever
          decrypted inside a server function to make a call on their behalf. Every one of those calls is written
          to the activity log.
        </div>
      </>}

      {modal && <AddPartner onClose={() => setModal(false)} onDone={async (link) => { setModal(false); setInvite(link); await load(); }} />}
      {invite && (
        <Modal title="Partner created" sub="Send them this link so they can set a password." onClose={() => setInvite(null)}
          footer={<button className="btn btn-primary" onClick={() => setInvite(null)}>Done</button>}>
          <div className="copybox">
            <code>{invite}</code>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(invite)}>Copy</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function AddPartner({ onClose, onDone }) {
  const [company_name, setCompany] = useState('');
  const [full_name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [platform, setPlatform] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title="Add partner" sub="They set their own password, then connect their own reseller account." onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !full_name || !email || !platform} onClick={async () => {
          setBusy(true); setErr('');
          try { const r = await api('partners', { method: 'POST', body: { company_name, full_name, email, platform } }); onDone(r.invite_link); }
          catch (e) { setErr(e.message); }
          setBusy(false);
        }}>{busy ? <><span className="spin" /> Creating</> : 'Create partner'}</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Platform</span>
        <div className="plat-choose">
          <button type="button" className={`pc-opt${platform === 'gogetssl' ? ' on gg' : ''}`} onClick={() => setPlatform('gogetssl')}>
            <span className="pd gg" /><span><b>GoGetSSL</b><small>V1 + V2 reseller</small></span>
          </button>
          <button type="button" className={`pc-opt${platform === 'thesslstore' ? ' on tss' : ''}`} onClick={() => setPlatform('thesslstore')}>
            <span className="pd tss" /><span><b>TheSSLStore</b><small>DigiCert-family</small></span>
          </button>
        </div>
        <div className="hint">This partner's account is permanently bound to the platform you choose.</div>
      </div>
      <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Company</span>
        <input value={company_name} onChange={e => setCompany(e.target.value)} /></div>
      <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Contact name</span>
        <input value={full_name} onChange={e => setName(e.target.value)} /></div>
      <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Email</span>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className="callout warn">
        You are not asked for their API credentials — they enter those themselves after signing in.
        Their API password is never visible to you.
      </div>
    </Modal>
  );
}
