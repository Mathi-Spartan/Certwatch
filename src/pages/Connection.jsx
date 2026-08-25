import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import { fmtTime } from '../lib/lifecycle.js';
import { ENVIRONMENTS, envLabel } from '../lib/platform.js';

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
    try {
      await api('credentials', { method: 'DELETE' });
      setNote('Disconnected. Your orders stay visible but nothing can be actioned.');
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div className="gp-head">
        <div>
          <h1>TheSSLStore connection</h1>
          <p>Your API credentials let Certwatch read your orders and manage certificates on your behalf.</p>
        </div>
      </div>

      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}
      {!c && !err && <div className="loading"><span className="spin" /> Checking your connection…</div>}

      {c && !c.connected && (
        <div className="panel" style={{ maxWidth: 720 }}>
          <div className="empty">
            <h3>No TheSSLStore account connected</h3>
            <p>Connect yours and every order you have ever placed appears here within a minute.</p>
            <button className="btn btn-primary" onClick={() => setModal(true)}>Connect TheSSLStore</button>
          </div>
        </div>
      )}

      {c && c.connected && (
        <div className="panel" style={{ maxWidth: 720 }}>
          <div className="panel-head">
            <h2>Connected</h2>
            <span className={`env-tag ${c.environment === 'sandbox' ? 'sandbox' : 'live'}`}>
              {c.environment === 'sandbox' ? 'Sandbox' : 'Live'}
            </span>
            <span className={`pill ${c.status === 'ok' ? 'ok' : 'bad'}`} style={{ marginLeft: 'auto' }}>
              {c.status === 'ok' ? `Verified ${fmtTime(c.last_verified_at)}` : 'Last call was rejected'}
            </span>
          </div>
          <div className="panel-body">
            <div className="meta" style={{ marginTop: 0 }}>
              <div><span className="lbl">Partner code</span><span className="v mono">{c.partner_code_masked}</span></div>
              <div><span className="lbl">Auth token</span><span className="v mono">•••••••••••••••</span></div>
              <div><span className="lbl">Environment</span><span className="v">{envLabel(c.environment)}</span></div>
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
        <b>What it cannot do:</b> place new orders or renewals. Nothing here can spend your balance.
        Your credentials are encrypted before they are stored and every call made with them is written to your activity log.
        <br /><br />
        <b>One call, complete book.</b> TheSSLStore returns every order in a single request — cancelled
        ones included — so there is never anything to import by hand.
      </div>

      {modal && (
        <ConnectModal
          current={c?.connected ? c.environment : 'live'}
          replacing={!!c?.connected}
          onClose={() => setModal(false)}
          onDone={async (m) => { setModal(false); setNote(m); await load(); }}
        />
      )}
    </>
  );
}

/**
 * The credential box. The partner picks which environment these credentials
 * belong to; that choice is saved with them, so every later call goes to the
 * matching TheSSLStore API. Live and sandbox issue separate credential pairs —
 * a sandbox token will not verify against live, and vice versa.
 */
function ConnectModal({ current, replacing, onClose, onDone }) {
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [env, setEnv] = useState(current || 'live');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const chosen = ENVIRONMENTS.find(e => e.id === env) || ENVIRONMENTS[0];

  async function save() {
    setBusy(true); setErr('');
    try {
      await api('credentials', {
        method: 'POST',
        body: { partner_code: code.trim(), auth_token: token.trim(), environment: env },
      });
      setToken('');
      try { await api('sync', { method: 'POST' }); } catch { /* retryable from the dashboard */ }
      onDone(`Verified against ${chosen.label}. Your orders are syncing now.`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <Modal
      title={replacing ? 'Replace your TheSSLStore credentials' : 'Connect your TheSSLStore account'}
      sub="We check the credentials against TheSSLStore before saving them."
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !code.trim() || !token.trim()} onClick={save}>
          {busy ? <><span className="spin" /> Verifying</> : 'Verify and save'}
        </button>
      </>}
    >
      {err && <div className="err">{err}</div>}

      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Environment</span>
        <select className="sel" style={{ width: '100%' }} value={env} onChange={e => setEnv(e.target.value)}>
          {ENVIRONMENTS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        <div className="hint">{chosen.hint}</div>
      </div>

      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">API Partner Code</span>
        <input value={code} onChange={e => setCode(e.target.value)} autoComplete="off" placeholder="e.g. 83300821" />
        <div className="hint">Shown on your TheSSLStore API Tokens page for the {chosen.label.split(' ')[0].toLowerCase()} environment.</div>
      </div>

      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Authentication Token</span>
        <input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="new-password" />
        <div className="hint">Generate it under Integration → API Tokens. It is shown only once, so paste it straight in.</div>
      </div>

      {replacing && env !== current && (
        <div className="callout warn">
          You are switching from <b>{envLabel(current)}</b> to <b>{chosen.label}</b>. Orders already synced
          from {envLabel(current)} stay in your list until the next sync replaces them.
        </div>
      )}

      <div className="callout">Saved encrypted. It is decrypted only to make a call you asked for, and every call is logged.</div>
    </Modal>
  );
}
