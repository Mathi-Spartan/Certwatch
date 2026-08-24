import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import { fmt } from '../lib/lifecycle.js';

const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export default function SubUsers() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(false);
  const [invite, setInvite] = useState(null);

  async function load() {
    try { setD(await api('subusers')); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function remove(s) {
    if (!confirm(`Remove ${s.full_name}? Their assigned certificates return to you.`)) return;
    try { await api('subusers', { method: 'DELETE', body: { id: s.id } }); await load(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <>
      <div className="gp-head">
        <div>
          <h1>Sub-users</h1>
          <p>People on your team who manage the certificates you assign them. They can do everything except renew.</p>
        </div>
        <div className="gp-head-actions"><button className="btn btn-primary" onClick={() => setModal(true)}>Add sub-user</button></div>
      </div>

      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="loading"><span className="spin" /> Loading…</div>}

      {d && (d.subusers.length === 0 ? (
        <div className="panel"><div className="empty">
          <h3>No sub-users yet</h3>
          <p>Add someone and assign them certificates to manage.</p>
          <button className="btn btn-primary" onClick={() => setModal(true)}>Add sub-user</button>
        </div></div>
      ) : (
        <div className="panel"><table className="tbl">
          <thead><tr><th>Sub-user</th><th>Assigned</th><th>Added</th><th /></tr></thead>
          <tbody>
            {d.subusers.map(s => (
              <tr key={s.id}>
                <td><div className="who">
                  <span className="av">{initials(s.full_name)}</span>
                  <span><b>{s.full_name}</b><span className="mono">{s.email}</span></span>
                </div></td>
                <td className="mono">{s.assigned}</td>
                <td className="mono" style={{ color: 'var(--muted)' }}>{fmt(s.created_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ))}

      {modal && <AddModal onClose={() => setModal(false)} onDone={async (link) => { setModal(false); setInvite(link); await load(); }} />}
      {invite && (
        <Modal title="Sub-user added" sub="Send them this link so they can set a password." onClose={() => setInvite(null)}
          footer={<button className="btn btn-primary" onClick={() => setInvite(null)}>Done</button>}>
          <div className="copybox">
            <code>{invite}</code>
            <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(invite)}>Copy</button>
          </div>
          <div className="hint" style={{ marginTop: 10, color: 'var(--muted)', fontSize: 12 }}>
            The link expires. If it lapses, they can use “Set or reset password” on the sign-in page.
          </div>
        </Modal>
      )}
    </>
  );
}

function AddModal({ onClose, onDone }) {
  const [full_name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title="Add sub-user" sub="They see only the certificates you assign them." onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !full_name || !email} onClick={async () => {
          setBusy(true); setErr('');
          try { const r = await api('subusers', { method: 'POST', body: { full_name, email } }); onDone(r.invite_link); }
          catch (e) { setErr(e.message); }
          setBusy(false);
        }}>{busy ? <><span className="spin" /> Adding</> : 'Add sub-user'}</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Full name</span>
        <input value={full_name} onChange={e => setName(e.target.value)} /></div>
      <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Email</span>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
    </Modal>
  );
}
