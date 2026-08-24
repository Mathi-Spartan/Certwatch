import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import { fmtTime } from '../lib/lifecycle.js';

export default function Connection() {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setC(await api('credentials')); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function disconnect() {
    setBusy(true);
    try { await api('credentials', { method: 'DELETE' }); setNote('Disconnected. Your orders stay visible but nothing can be actioned.'); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="gp-head">
        <div>
          <h1>GoGetSSL connection</h1>
          <p>Your API credentials let Certwatch read your orders and manage certificates on your behalf.</p>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}
      {!c && !err && <div className="loading"><span className="spin" /> Checking your connection…</div>}

      {c && !c.connected && (
        <div className="panel" style={{ maxWidth: 720 }}>
          <div className="empty">
            <h3>No GoGetSSL account connected</h3>
            <p>Connect yours and every order you have ever placed appears here within a minute.</p>
            <button className="btn btn-primary" onClick={() => setModal(true)}>Connect GoGetSSL</button>
          </div>
        </div>
      )}

      {c && c.connected && (
        <div className="panel" style={{ maxWidth: 720 }}>
          <div className="panel-head">
            <h2>Connected</h2>
            <span className={`pill ${c.status === 'ok' ? 'ok' : 'bad'}`} style={{ marginLeft: 'auto' }}>
              {c.status === 'ok' ? `Verified ${fmtTime(c.last_verified_at)}` : 'Last call was rejected'}
            </span>
          </div>
          <div className="panel-body">
            <div className="meta" style={{ marginTop: 0 }}>
              <div><span className="lbl">GoGetSSL login</span><span className="v mono">{c.login_masked}</span></div>
              <div><span className="lbl">API password</span><span className="v mono">•••••••••••••••</span></div>
              <div><span className="lbl">Orders synced</span><span className="v mono">{c.orders_synced ?? 0}</span></div>
              <div><span className="lbl">Last sync</span><span className="v mono">{fmtTime(c.last_sync_at)}</span></div>
            </div>
            <div className="acts">
              <button className="btn" onClick={() => setModal(true)}>Replace credentials</button>
              <span className="spacer" />
              <button className="btn btn-danger" onClick={disconnect} disabled={busy}>Disconnect</button>
            </div>
          </div>
        </div>
      )}

      <div className="callout" style={{ marginTop: 18 }}>
        <b>What Certwatch can do with your credentials:</b> read your orders, reissue certificates,
        download certificates, and manage domain validation.{' '}
        <b>What it cannot do:</b> place new orders or renewals. Nothing here can spend your GoGetSSL balance.
        Your API password is encrypted before it is stored and every call made with it is written to your activity log.
      </div>

      {modal && <ConnectModal onClose={() => setModal(false)} onDone={async (m) => { setModal(false); setNote(m); await load(); }} />}
    </>
  );
}

function ConnectModal({ onClose, onDone }) {
  const [login, setLogin] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      await api('credentials', { method: 'POST', body: { login, api_password: pw } });
      setPw('');
      try { await api('sync', { method: 'POST' }); } catch { /* the sync can be retried */ }
      onDone('Credentials verified. Your orders are syncing now.');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <Modal title="Connect your GoGetSSL account"
      sub="We check the credentials against GoGetSSL before saving them."
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !login || !pw} onClick={save}>
          {busy ? <><span className="spin" /> Verifying</> : 'Verify and save'}
        </button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">GoGetSSL login</span>
        <input value={login} onChange={e => setLogin(e.target.value)} autoComplete="off" />
        <div className="hint">The same login you use for the GoGetSSL client area.</div>
      </div>
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">API password</span>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
        <div className="hint">Generate this in your GoGetSSL client area under Reseller Modules → API settings. It is not your account password.</div>
      </div>
      <div className="callout">Saved encrypted. It is decrypted only to make a call you asked for, and every call is logged.</div>
    </Modal>
  );
}
