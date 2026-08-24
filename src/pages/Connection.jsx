import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Modal from '../components/Modal.jsx';
import { fmtTime } from '../lib/lifecycle.js';
import { getPlatform } from '../lib/platform.js';

export default function Connection() {
  const platform = getPlatform() || 'gogetssl';
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const all = await api('credentials');
      setC(all[platform] || { connected: false });
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [platform]);

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
          <h1>{platform === 'thesslstore' ? 'TheSSLStore' : 'GoGetSSL'} connection</h1>
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
              {platform === 'thesslstore' ? <>
                <div><span className="lbl">Partner code</span><span className="v mono">{c.partner_code_masked}</span></div>
                <div><span className="lbl">Auth token</span><span className="v mono">•••••••••••••••</span></div>
                <div><span className="lbl">Environment</span><span className="v mono">{c.environment}</span></div>
                <div><span className="lbl">Orders synced</span><span className="v mono">{c.orders_synced ?? 0}</span></div>
              </> : <>
                <div><span className="lbl">GoGetSSL login</span><span className="v mono">{c.login_masked}</span></div>
                <div><span className="lbl">API password</span><span className="v mono">•••••••••••••••</span></div>
                <div><span className="lbl">Partner code</span>
                  {c.partner_code
                    ? <span className="v mono">{c.partner_code}</span>
                    : <span className="v dim">Not set — automation orders unavailable</span>}
                </div>
                <div><span className="lbl">Orders synced</span><span className="v mono">{c.orders_synced ?? 0}</span></div>
              </>}
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
        {platform === 'thesslstore' && <><br/><br/><b>TheSSLStore syncs completely</b> — one call returns your entire order book, cancelled orders included, so there is nothing to import by hand.</>}
      </div>

      {c && c.connected && platform === 'gogetssl' && (
        <div className="panel" style={{ maxWidth: 720, marginTop: 18 }}>
          <div className="panel-head">
            <h2>Import orders by ID</h2>
            <span className="sub" style={{ marginLeft: 'auto' }}>for orders a sync cannot find</span>
          </div>
          <div className="panel-body">
            <p style={{ margin: '0 0 12px', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.55 }}>
              GoGetSSL will not list cancelled orders, and automation subscriptions have no listing at all.
              Paste the order numbers here — or the whole OrderDetail CSV export from your GoGetSSL panel —
              and we will look each one up and keep it current from then on. AutoInstall subscriptions are
              the one exception: they can only be found by their item ID, so paste those too if you have them.
            </p>
            <ImportBox onDone={load} />
          </div>
        </div>
      )}

      {modal && (platform === 'thesslstore'
        ? <ConnectTssModal onClose={() => setModal(false)} onDone={async (m) => { setModal(false); setNote(m); await load(); }} />
        : <ConnectModal onClose={() => setModal(false)} onDone={async (m) => { setModal(false); setNote(m); await load(); }} />)}
    </>
  );
}

function ImportBox({ onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  function loadFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { setText(String(r.result)); setErr(''); setResult(null); };
    r.onerror = () => setErr('That file could not be read.');
    r.readAsText(file);
  }

  /** Batched: keep calling until the server says there is nothing left. */
  async function run() {
    setBusy(true); setErr(''); setResult(null); setProgress(null);
    const totals = { stored: 0, imported: 0, notFound: [], mode: null, total: 0 };
    let offset = 0;
    try {
      for (let guard = 0; guard < 500; guard++) {
        const r = await api('import', { method: 'POST', body: { text, offset } });
        totals.mode = r.mode;
        totals.total = r.total;
        totals.stored += r.stored || 0;
        totals.imported += (r.imported || []).length;
        totals.notFound.push(...(r.not_found || []));
        setProgress({ done: r.done, total: r.total });
        if (r.next_offset == null) break;
        offset = r.next_offset;
      }
      setResult(totals);
      setText('');
      onDone?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
    setProgress(null);
  }

  return (
    <>
      {err && <div className="err">{err}</div>}
      {result && (
        <div className={(result.stored || result.imported) ? 'ok-note' : 'err'}>
          {result.mode === 'csv'
            ? `Added ${result.stored} of ${result.total} rows from the panel export.`
            : `Resolved ${result.imported} of ${result.total} order IDs.`}
          {result.notFound.length > 0 && (
            <div style={{ marginTop: 6 }}>
              Could not resolve <span className="mono">{result.notFound.slice(0, 10).join(', ')}</span>
              {result.notFound.length > 10 ? ` and ${result.notFound.length - 10} more` : ''}.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <label className="btn" style={{ cursor: 'pointer' }}>
          Choose CSV export
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                 onChange={e => loadFile(e.target.files?.[0])} />
        </label>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          or paste order IDs / the CSV contents below
        </span>
      </div>

      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setResult(null); }}
        placeholder={'Paste API order numbers, one per line\n\n…or drop in the Certificates CSV export from your GoGetSSL panel'}
        style={{ minHeight: 110 }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={run}>
          {busy ? <><span className="spin" /> {progress ? `Importing ${progress.done} of ${progress.total}` : 'Reading'}</> : 'Import orders'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Any size — it runs in batches.
        </span>
      </div>
    </>
  );
}

function ConnectTssModal({ onClose, onDone }) {
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [env, setEnv] = useState('live');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      await api('credentials', { method: 'POST', platform: 'thesslstore',
        body: { partner_code: code, auth_token: token, environment: env } });
      setToken('');
      try { await api('sync', { method: 'POST', platform: 'thesslstore' }); } catch { /* retryable */ }
      onDone(`Verified against the ${env} environment. Your orders are syncing now.`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <Modal title="Connect your TheSSLStore account"
      sub="We check the credentials against TheSSLStore before saving them."
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !code || !token} onClick={save}>
          {busy ? <><span className="spin" /> Verifying</> : 'Verify and save'}
        </button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Environment</span>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={env === 'live' ? 'on' : ''} onClick={() => setEnv('live')} type="button">Production (Live)</button>
          <button className={env === 'sandbox' ? 'on' : ''} onClick={() => setEnv('sandbox')} type="button">Sandbox (Test)</button>
        </div>
      </div>
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">API Partner Code</span>
        <input value={code} onChange={e => setCode(e.target.value)} autoComplete="off" placeholder="e.g. 83300821" />
        <div className="hint">Shown on your TheSSLStore API Tokens page for the {env} environment.</div>
      </div>
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Authentication Token</span>
        <input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="new-password" />
        <div className="hint">Generate it under Integration → API Tokens. It is shown only once, so paste it straight in.</div>
      </div>
      <div className="callout">Saved encrypted. It is decrypted only to make a call you asked for, and every call is logged.</div>
    </Modal>
  );
}

function ConnectModal({ onClose, onDone }) {
  const [login, setLogin] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr('');
    try {
      const r = await api('credentials', { method: 'POST', body: { login, api_password: pw, partner_code: code } });
      setPw('');
      try { await api('sync', { method: 'POST' }); } catch { /* the sync can be retried */ }
      onDone(r.v2_ok === false
        ? 'Saved, but the partner code was rejected — only standard SSL orders will appear. Check the code on your API Settings page.'
        : r.v2_ok
          ? 'Verified for both standard and automation orders. Syncing now.'
          : 'Credentials verified. Your orders are syncing now.');
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
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">API partner code <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)', fontWeight: 400 }}>— optional</span></span>
        <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" placeholder="e.g. 133617" />
        <div className="hint">
          Shown as “API Partner Code” on the same GoGetSSL API Settings page. Without it we can only reach
          your standard SSL orders; with it we also reach your ACME and AutoInstall subscriptions.
        </div>
      </div>
      <div className="callout">Saved encrypted. It is decrypted only to make a call you asked for, and every call is logged.</div>
    </Modal>
  );
}
