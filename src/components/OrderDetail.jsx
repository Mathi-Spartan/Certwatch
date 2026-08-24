import { useEffect, useState } from 'react';
import Rail from './Rail.jsx';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';
import { lifecycle, fmt, fmtTime, statusOf, DCV_STATE, dcvRows } from '../lib/lifecycle.js';
import { generateCsrBundle } from '../lib/csr.js';

const WEBSERVERS = [
  'Apache + OpenSSL', 'Nginx', 'IIS 10', 'IIS 8/9', 'cPanel/WHM',
  'Plesk', 'Tomcat', 'Amazon Load Balancer', 'Other',
];
const METHODS = [
  { v: 'dns',   t: 'DNS (CNAME record)' },
  { v: 'http',  t: 'HTTP file' },
  { v: 'https', t: 'HTTPS file' },
  { v: 'email', t: 'Approver email' },
];

export default function OrderDetail({ order, profile, subusers, onChanged }) {
  const [live, setLive] = useState(order);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(null);

  useEffect(() => {
    let gone = false;
    if (order.api_linked === false) return () => { gone = true; };
    (async () => {
      try {
        const fresh = await api(`orders?id=${encodeURIComponent(order.gg_order_id)}`);
        if (!gone) setLive(fresh);
      } catch (e) { if (!gone) setErr(e.message); }
    })();
    return () => { gone = true; };
  }, [order.gg_order_id]);

  const raw = live.raw || {};
  const lc = lifecycle(live);
  const st = statusOf(live.gg_status);
  const rows = dcvRows(raw);
  const pending = rows.filter(r => r.state < 2).length;
  const dead = ['cancelled', 'expired', 'rejected'].includes(live.gg_status);
  const isSub = profile.role === 'sub_user';
  // V2 orders are automation subscriptions: issuance, reissue and validation
  // are driven by the customer's ACME client or agent, not by this API.
  const isV2 = live.api_version === 'v2';
  // TheSSLStore orders use a different API with its own action set.
  const isTss = live.platform === 'thesslstore' || live.api_version === 'tss';
  // Rows from the panel export carry the CA's own status but no API order id,
  // so nothing can be actioned against the CA for them.
  const unlinked = live.api_linked === false;

  async function act(action, body = {}, okMessage) {
    setBusy(true); setErr(''); setNote('');
    try {
      const r = await api('action', { method: 'POST', body: { action, order_id: live.gg_order_id, ...body } });
      if (r.order) setLive(l => ({ ...l, raw: r.order, gg_status: (r.order.status || '').toLowerCase() }));
      setNote(okMessage || 'Done.');
      setModal(null);
      onChanged?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const meta = [
    ['Days to reissue', dead || !lc ? <span className="v dim">—</span> :
      <span className="v"><b className="mono">{lc.toReissue}</b> days — certificate expires <span className="mono">{fmt(live.valid_till)}</span></span>],
    ['Certificate validity', <span className="v mono">{fmt(live.valid_from)} → {fmt(live.valid_till)}</span>],
    ['Order expiry', <span className="v mono">{fmt(live.expires_at)}</span>],
    ['Certificate authority', <span className="v">{raw.brand || raw.ca || live.product_name?.split(' ')[0] || '—'}</span>],
    ['API order ID', <span className="v mono">{live.gg_order_id}</span>],
    ['Web server', <span className="v">{raw.webserver_type || raw.server_type || '—'}</span>],
    ...(profile.role === 'partner'
      ? [['Assigned to', <span className={`v${live.assigned_to ? '' : ' dim'}`}>
          {subusers?.find(s => s.id === live.assigned_to)?.full_name || 'Unassigned'}</span>]]
      : []),
  ];

  return (
    <div className="detail">
      {err && <div className="err">{err}</div>}
      {note && <div className="ok-note">{note}</div>}

      {unlinked && (
        <div className="callout warn">
          This came from your GoGetSSL panel export. The status and dates are the CA's own, but the export
          does not include an API order number, so this order cannot be managed from here. Open it in the
          GoGetSSL panel and paste its <b>API Order ID</b> into Import to link it up.
        </div>
      )}
      {lc
        ? <div className="rail-wrap"><Rail order={live} showEnds /></div>
        : !unlinked && <div className="callout">This order has no issued certificate yet, so there is no lifecycle to show.</div>}

      <div className="meta">
        {meta.map(([k, v]) => <div key={k}><span className="lbl">{k}</span>{v}</div>)}
      </div>

      <div className="section-rule">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="lbl" style={{ margin: 0 }}>Domain control validation</span>
          {rows.length === 0
            ? <span className="pill mute">No validation data</span>
            : pending
              ? <span className="pill warn">{pending} awaiting validation</span>
              : <span className="pill ok">All domains validated</span>}
          {!dead && (
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} disabled={busy}
              onClick={async () => {
                setBusy(true); setErr('');
                try { setLive(await api(`orders?id=${encodeURIComponent(live.gg_order_id)}`)); setNote('Validation status re-read from the CA.'); }
                catch (e) { setErr(e.message); }
                setBusy(false);
              }}>Recheck status</button>
          )}
        </div>

        {rows.length > 0 && (
          <table className="dcv">
            <thead><tr><th>Domain</th><th>Method</th><th>Approver</th><th>State</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono dom">{r.domain}</td>
                  <td>{r.method}</td>
                  <td className="mono" style={{ color: 'var(--muted)' }}>{r.approver || '—'}</td>
                  <td><span className={`pill ${(DCV_STATE[r.state] || DCV_STATE[0]).c}`}>{(DCV_STATE[r.state] || DCV_STATE[0]).t}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="acts" style={unlinked ? { display: 'none' } : undefined}>
        {isTss ? (
          <>
            {!dead && <button className="btn btn-primary" disabled={busy} onClick={() => setModal('reissue')}>Reissue certificate</button>}
            <button className="btn" disabled={busy} onClick={() => act('download', {}, 'Certificate download requested.')}>Download</button>
            {!dead && <>
              <button className="btn" disabled={busy} onClick={() => setModal('approver')}>Change approver</button>
              <button className="btn" disabled={busy} onClick={() => act('resend_approver', {}, 'Approver email sent again.')}>Resend approver email</button>
            </>}
            {profile.role === 'partner' && <button className="btn" disabled={busy} onClick={() => setModal('assign')}>Assign to sub-user</button>}
            <span className="spacer" />
            {!dead && <button className="btn btn-danger" disabled={busy} onClick={() => setModal('revoke')}>Revoke</button>}
            <div className="acts-note">
              {isSub
                ? 'Renewing is handled by your partner. Everything else here is yours to run.'
                : 'Renewals are placed from TheSSLStore directly — this portal never spends your balance.'}
              {' '}Last synced {fmtTime(live.last_synced_at)}.
            </div>
          </>
        ) : (
        <>
        {!dead && !isV2 && <button className="btn btn-primary" disabled={busy} onClick={() => setModal('reissue')}>Reissue certificate</button>}
        {!isV2 && <button className="btn" disabled={busy} onClick={() => setModal('download')}>Download</button>}
        {!dead && !isV2 && <>
          <button className="btn" disabled={busy} onClick={() => setModal('method')}>Change validation method</button>
          <button className="btn" disabled={busy} onClick={() => setModal('approver')}>Change approver email</button>
          <button className="btn" disabled={busy} onClick={() => act('resend_approver', {}, 'Approver email sent again.')}>Resend approver email</button>
          <button className="btn" disabled={busy} onClick={() => act('revalidate', {}, 'Revalidation requested from the CA.')}>Revalidate</button>
        </>}
        {profile.role === 'partner' && <button className="btn" disabled={busy} onClick={() => setModal('assign')}>Assign to sub-user</button>}
        <span className="spacer" />
        {!dead && <button className="btn btn-danger" disabled={busy} onClick={() => setModal('cancel')}>Cancel order</button>}
        <div className="acts-note">
          {isV2 && <div style={{ marginBottom: 6 }}>
            This is an automation subscription ({live.gg_category?.toUpperCase() || 'V2'}). Certificates are
            issued and renewed by your ACME client or the AutoInstall agent, so there is nothing here to
            reissue or validate by hand.
          </div>}
          {isSub
            ? 'Renewing this order is handled by your partner. Everything else here is yours to run.'
            : 'Renewals are placed from your GoGetSSL account — this portal never spends your balance.'}
          {' '}Last synced {fmtTime(live.last_synced_at)}{live.live === false ? ' · showing the stored copy, the CA did not answer' : ''}.
        </div>
        </>
        )}
      </div>

      {modal === 'reissue' && <ReissueModal order={live} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
      {modal === 'download' && <DownloadModal order={live} raw={raw} onClose={() => setModal(null)} />}
      {modal === 'method' && <MethodModal rows={rows} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
      {modal === 'approver' && <ApproverModal rows={rows} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
      {modal === 'assign' && <AssignModal order={live} subusers={subusers} onClose={() => setModal(null)} onDone={onChanged} />}
      {modal === 'cancel' && <CancelModal order={live} lc={lc} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
      {modal === 'revoke' && <RevokeModal order={live} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
    </div>
  );
}

/* ── reissue ─────────────────────────────────────────────────────────── */
function ReissueModal({ order, busy, onClose, onSubmit }) {
  const [tab, setTab] = useState('paste');
  const [csr, setCsr] = useState('');
  const [webserver, setWebserver] = useState(order.raw?.webserver_type || 'Nginx');
  const [method, setMethod] = useState('dns');
  const [keyType, setKeyType] = useState('2048');
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState('');

  async function generateAndSubmit() {
    setGenerating(true); setGenErr('');
    try {
      // Keypair is made here, in the browser. The private key is packaged into
      // a ZIP for download and is never sent to our servers.
      const { csrPem, downloadZip } = await generateCsrBundle({
        commonName: order.common_name,
        bits: Number(keyType),
      });
      await downloadZip();
      await onSubmit('reissue', { csr: csrPem, webserver_type: webserver, dcv_method: method },
        'Keypair downloaded and reissue submitted to the CA.');
    } catch (e) { setGenErr(e.message); }
    setGenerating(false);
  }

  return (
    <Modal
      title={`Reissue ${order.common_name || order.gg_order_id}`}
      sub={`Order ${order.gg_order_id} · ${order.product_name || ''}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {tab === 'paste'
          ? <button className="btn btn-primary" disabled={busy || !csr.trim()}
              onClick={() => onSubmit('reissue', { csr: csr.trim(), webserver_type: webserver, dcv_method: method }, 'Reissue submitted to the CA.')}>
              {busy ? <><span className="spin" /> Submitting</> : 'Submit reissue'}
            </button>
          : <button className="btn btn-primary" disabled={busy || generating} onClick={generateAndSubmit}>
              {generating ? <><span className="spin" /> Generating</> : 'Generate and reissue'}
            </button>}
      </>}
    >
      <div className="tabs">
        <button className={tab === 'paste' ? 'on' : ''} onClick={() => setTab('paste')}>I have a CSR</button>
        <button className={tab === 'gen' ? 'on' : ''} onClick={() => setTab('gen')}>Generate one for me</button>
      </div>

      {genErr && <div className="err">{genErr}</div>}

      {tab === 'paste' ? (
        <div className="field" style={{ maxWidth: 'none' }}>
          <span className="lbl">Certificate signing request</span>
          <textarea value={csr} onChange={e => setCsr(e.target.value)} placeholder="-----BEGIN CERTIFICATE REQUEST-----" />
        </div>
      ) : (
        <>
          <div className="callout">
            <b>The private key is generated in this browser and never sent to us.</b> You will get a ZIP
            containing the CSR and the key. We cannot send it again — save it before you close this box.
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 150 }}>
              <span className="lbl">Key size</span>
              <select className="sel" style={{ width: '100%' }} value={keyType} onChange={e => setKeyType(e.target.value)}>
                <option value="2048">RSA 2048</option>
                <option value="4096">RSA 4096</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 150 }}>
              <span className="lbl">Common name</span>
              <input value={order.common_name || ''} readOnly />
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 150 }}>
          <span className="lbl">Web server</span>
          <select className="sel" style={{ width: '100%' }} value={webserver} onChange={e => setWebserver(e.target.value)}>
            {WEBSERVERS.map(w => <option key={w}>{w}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 150 }}>
          <span className="lbl">Validation method</span>
          <select className="sel" style={{ width: '100%' }} value={method} onChange={e => setMethod(e.target.value)}>
            {METHODS.map(m => <option key={m.v} value={m.v}>{m.t}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

/* ── download ────────────────────────────────────────────────────────── */
function DownloadModal({ order, raw, onClose }) {
  const crt = raw.crt_code || raw.certificate || raw.crt || '';
  const ca = raw.ca_code || raw.ca_bundle || raw.ca || '';

  const save = (name, text) => {
    const blob = new Blob([text], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const base = (order.common_name || order.gg_order_id).replace(/^\*\./, 'wildcard.');

  return (
    <Modal
      title={`Download ${order.common_name || order.gg_order_id}`}
      sub={`Issued ${fmt(order.valid_from)} · expires ${fmt(order.valid_till)}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      {crt ? (
        <>
          <div className="keyline">{crt.slice(0, 400)}{crt.length > 400 ? '…' : ''}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => save(`${base}.crt`, crt)}>Certificate (.crt)</button>
            {ca && <button className="btn" onClick={() => save(`${base}-ca-bundle.crt`, ca)}>CA bundle</button>}
            {ca && <button className="btn btn-primary" onClick={() => save(`${base}-fullchain.pem`, `${crt}\n${ca}`)}>Full chain (.pem)</button>}
          </div>
          <div style={{ marginTop: 14, color: 'var(--muted)', fontSize: 12 }}>
            The private key is not here. It never left the machine that made the CSR.
          </div>
        </>
      ) : (
        <div className="callout warn">
          The CA has not issued a certificate for this order yet, so there is nothing to download.
          Finish domain validation first.
        </div>
      )}
    </Modal>
  );
}

/* ── change validation method ────────────────────────────────────────── */
function MethodModal({ rows, busy, onClose, onSubmit }) {
  const open = rows.filter(r => r.state < 2);
  const [domain, setDomain] = useState(open[0]?.domain || '');
  const [method, setMethod] = useState('dns');
  return (
    <Modal title="Change validation method" sub="Only domains still awaiting validation can be changed." onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !domain}
          onClick={() => onSubmit('change_method', { domain, new_method: method }, 'Validation method updated.')}>Save changes</button>
      </>}>
      {open.length === 0
        ? <div className="callout">Every domain on this order is already validated, so there is nothing to change.</div>
        : <>
            <div className="field" style={{ maxWidth: 'none' }}>
              <span className="lbl">Domain</span>
              <select className="sel" style={{ width: '100%' }} value={domain} onChange={e => setDomain(e.target.value)}>
                {open.map(r => <option key={r.domain}>{r.domain}</option>)}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 'none' }}>
              <span className="lbl">New method</span>
              <select className="sel" style={{ width: '100%' }} value={method} onChange={e => setMethod(e.target.value)}>
                {METHODS.map(m => <option key={m.v} value={m.v}>{m.t}</option>)}
              </select>
            </div>
          </>}
    </Modal>
  );
}

/* ── change approver ─────────────────────────────────────────────────── */
function ApproverModal({ rows, busy, onClose, onSubmit }) {
  const open = rows.filter(r => r.state < 2);
  const [domain, setDomain] = useState(open[0]?.domain || '');
  const [email, setEmail] = useState('');
  const bare = (domain || '').replace(/^\*\./, '');
  const suggestions = ['admin', 'administrator', 'webmaster', 'hostmaster', 'postmaster'].map(p => `${p}@${bare}`);

  return (
    <Modal title="Change approver email" sub="The CA only accepts a fixed set of addresses for each domain." onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !email || !domain}
          onClick={() => onSubmit('change_approver', { domain, new_email: email }, 'Approver changed — a new email has been sent.')}>Change and send</button>
      </>}>
      {open.length === 0
        ? <div className="callout">Every domain on this order is already validated.</div>
        : <>
            <div className="field" style={{ maxWidth: 'none' }}>
              <span className="lbl">Domain</span>
              <select className="sel" style={{ width: '100%' }} value={domain} onChange={e => { setDomain(e.target.value); setEmail(''); }}>
                {open.map(r => <option key={r.domain}>{r.domain}</option>)}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 'none' }}>
              <span className="lbl">Approver address</span>
              <select className="sel" style={{ width: '100%' }} value={email} onChange={e => setEmail(e.target.value)}>
                <option value="">Choose an address</option>
                {suggestions.map(s => <option key={s}>{s}</option>)}
              </select>
              <div className="hint">Changing this sends a fresh approval email straight away.</div>
            </div>
          </>}
    </Modal>
  );
}

/* ── assign ──────────────────────────────────────────────────────────── */
function AssignModal({ order, subusers, onClose, onDone }) {
  const [sel, setSel] = useState(order.assigned_to || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <Modal title={`Assign ${order.common_name || order.gg_order_id}`}
      sub="The sub-user gets full management of this certificate, except renewal." onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try {
            await api('assign', { method: 'POST', body: { order_id: order.gg_order_id, sub_user_id: sel || null, platform: order.platform } });
            onDone?.(); onClose();
          } catch (e) { setErr(e.message); }
          setBusy(false);
        }}>{busy ? <><span className="spin" /> Saving</> : 'Assign'}</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Sub-user</span>
        <select className="sel" style={{ width: '100%' }} value={sel} onChange={e => setSel(e.target.value)}>
          <option value="">Unassigned</option>
          {(subusers || []).map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
        </select>
      </div>
    </Modal>
  );
}

/* ── cancel ──────────────────────────────────────────────────────────── */
function CancelModal({ order, lc, busy, onClose, onSubmit }) {
  const [typed, setTyped] = useState('');
  const target = order.common_name || order.gg_order_id;
  return (
    <Modal title={`Cancel order ${order.gg_order_id}`}
      sub="This cannot be undone. The certificate stops working once the CA revokes it." onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Keep the order</button>
        <button className="btn btn-danger" disabled={busy || typed.trim() !== target}
          onClick={() => onSubmit('cancel', { reason: 'Cancelled from Certwatch' }, 'Cancellation submitted to GoGetSSL.')}>
          {busy ? <><span className="spin" /> Cancelling</> : 'Cancel this order'}
        </button>
      </>}>
      <div className="callout warn">
        <b>{target}</b>
        {lc ? ` has ${lc.reissues} reissue${lc.reissues === 1 ? '' : 's'} left and ${lc.toOrderEnd} days remaining on the order. Cancelling forfeits both.` : ' will be cancelled at the CA.'}
      </div>
      <div className="field" style={{ maxWidth: 'none', marginTop: 16 }}>
        <span className="lbl">Type the domain to confirm</span>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={target} />
      </div>
    </Modal>
  );
}

/* ── revoke (TheSSLStore) ────────────────────────────────────────────── */
function RevokeModal({ order, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Revoke certificate"
      sub="This asks TheSSLStore to revoke the issued certificate. It cannot be undone."
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Keep it</button>
        <button className="btn btn-danger" disabled={busy}
          onClick={() => onSubmit('revoke', { reason: reason.trim() || 'Revoked from Certwatch' }, 'Revocation requested from TheSSLStore.')}>
          {busy ? <><span className="spin" /> Revoking</> : 'Revoke certificate'}
        </button>
      </>}>
      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Reason <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)', fontWeight: 400 }}>— optional</span></span>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. key compromise, superseded" />
      </div>
      <div className="callout warn">Revoking is permanent. The certificate stops being trusted once the CA processes the request.</div>
    </Modal>
  );
}