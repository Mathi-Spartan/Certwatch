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

export default function OrderDetail({ order, profile, subusers, onChanged }) {
  const [live, setLive] = useState(order);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(null);

  useEffect(() => {
    let gone = false;
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
  // An order bought in the TheSSLStore dashboard but never configured. It
  // carries its own enrolment token, which is what lets us complete it.
  // Only an order that was never configured can be generated. Once submitted
  // it is Pending with the CA and offering Generate again is misleading — the
  // token is spent and the call would fail.
  const incomplete = live.gg_status === 'processing'
    && (raw.OrderStatus?.MajorStatus || '').toLowerCase() === 'initial'
    && !!(raw.Token || (raw.TokenID && raw.TokenCode));
  // Generation belongs to whoever owns the certificate. Once an order has been
  // assigned, that is the end user — the partner hands it over and steps back,
  // so the button moves rather than being shared. Unassigned orders stay the
  // partner's to complete.
  const isSub = profile.role === 'sub_user';
  const canGenerate = incomplete && (isSub || !live.assigned_to);

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

      {lc
        ? <div className="rail-wrap"><Rail order={live} showEnds /></div>
        : <div className="callout">This order has no issued certificate yet, so there is no lifecycle to show.</div>}

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
                try {
                  // Ask the CA directly rather than re-reading our cached row:
                  // /digicert/checkdcv reports the live validation state, and
                  // /order/live-order-status the live order state. Our stored
                  // copy only changes when a sync happens to run.
                  await api('action', { method: 'POST', body: {
                    action: 'check_dcv', order_id: live.gg_order_id,
                    domain: live.common_name || '',
                  } }).catch(() => null);
                  await api('action', { method: 'POST', body: {
                    action: 'live_status', order_id: live.gg_order_id,
                  } }).catch(() => null);
                  setLive(await api(`orders?id=${encodeURIComponent(live.gg_order_id)}`));
                  setNote('Validation state re-read from the certificate authority.');
                  onChanged?.();
                }
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

      <div className="acts">
        {canGenerate && <button className="btn btn-primary" disabled={busy} onClick={() => setModal('generate')}>Generate certificate</button>}
        {!dead && !incomplete && <button className="btn btn-primary" disabled={busy} onClick={() => setModal('reissue')}>Reissue certificate</button>}
        <button className="btn" disabled={busy} onClick={() => setModal('download')}>Download</button>
        {!dead && <>
          <button className="btn" disabled={busy} onClick={() => setModal('approver')}>Change approver</button>
          <button className="btn" disabled={busy} onClick={() => act('resend_approver', {}, 'Approver email sent again.')}>Resend approver email</button>
        </>}
        {profile.role === 'partner' && <button className="btn" disabled={busy} onClick={() => setModal('assign')}>Assign to sub-user</button>}
        <span className="spacer" />
        {!dead && <button className="btn btn-danger" disabled={busy} onClick={() => setModal('revoke')}>Revoke</button>}
        {incomplete && !canGenerate && (
          <span className="handed-off">Assigned — the end user generates this certificate.</span>
        )}
        <div className="acts-note">
          {isSub
            ? 'Renewing is handled by your partner. Everything else here is yours to run.'
            : 'Renewals are placed from TheSSLStore directly — this portal never spends your balance.'}
          {' '}Last synced {fmtTime(live.last_synced_at)}{live.live === false ? ' · showing the stored copy, the CA did not answer' : ''}.
        </div>
      </div>

      {modal === 'generate' && <GenerateModal order={live} onClose={() => setModal(null)}
        onDone={(m) => { setModal(null); setNote(m); onChanged?.(); }} />}
      {modal === 'reissue' && <ReissueModal order={live} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
      {modal === 'download' && <DownloadModal order={live} onClose={() => setModal(null)} />}
      {modal === 'approver' && <ApproverModal rows={rows} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
      {modal === 'assign' && <AssignModal order={live} subusers={subusers} onClose={() => setModal(null)} onDone={onChanged} />}
      {modal === 'revoke' && <RevokeModal order={live} busy={busy} onClose={() => setModal(null)} onSubmit={act} />}
    </div>
  );
}

/* ── reissue ─────────────────────────────────────────────────────────── */
function ReissueModal({ order, busy, onClose, onSubmit }) {
  const [tab, setTab] = useState('paste');
  const [csr, setCsr] = useState('');
  const [webserver, setWebserver] = useState(order.raw?.webserver_type || 'Nginx');
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
      await onSubmit('reissue', { csr: csrPem, webserver_type: webserver },
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
              onClick={() => onSubmit('reissue', { csr: csr.trim(), webserver_type: webserver }, 'Reissue submitted to the CA.')}>
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

      <div className="field" style={{ maxWidth: 'none', marginTop: 4 }}>
        <span className="lbl">Web server</span>
        <select className="sel" style={{ width: '100%' }} value={webserver} onChange={e => setWebserver(e.target.value)}>
          {WEBSERVERS.map(w => <option key={w}>{w}</option>)}
        </select>
      </div>
    </Modal>
  );
}

/* ── download ────────────────────────────────────────────────────────── */
/**
 * Certificate material is fetched from TheSSLStore when this opens rather than
 * read from the stored row — an order row carries status and dates, not PEM.
 */
function DownloadModal({ order, onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r = await api('action', { method: 'POST', body: { action: 'download', order_id: order.gg_order_id } });
        if (!gone) setState({ loading: false, data: r.result || {} });
      } catch (e) {
        if (!gone) setState({ loading: false, error: e.message });
      }
    })();
    return () => { gone = true; };
  }, [order.gg_order_id]);

  const save = (name, text) => {
    const blob = new Blob([text], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const base = (order.common_name || order.gg_order_id).replace(/^\*\./, 'wildcard.');

  // TheSSLStore has returned the certificate under a few different keys over
  // the years, so take the first that actually carries PEM.
  const d = state.data || {};
  const certs = Array.isArray(d.Certificates) ? d.Certificates : [];
  const crt = d.CertificateContent || certs[0]?.CertificateContent || d.Certificate || '';
  const ca = d.CaCertificateContent || d.CaCertificates || certs[0]?.CaCertificateContent || '';
  const caText = Array.isArray(ca) ? ca.map(x => x.CaCertificateContent || x).join('\n') : ca;

  return (
    <Modal
      title={`Download ${order.common_name || order.gg_order_id}`}
      sub={`Issued ${fmt(order.valid_from)} · expires ${fmt(order.valid_till)}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      {state.loading && <div className="loading"><span className="spin" /> Fetching the certificate from TheSSLStore…</div>}
      {state.error && <div className="err">{state.error}</div>}

      {!state.loading && !state.error && (crt ? (
        <>
          <div className="keyline">{crt.slice(0, 400)}{crt.length > 400 ? '…' : ''}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => save(`${base}.crt`, crt)}>Certificate (.crt)</button>
            {caText && <button className="btn" onClick={() => save(`${base}-ca-bundle.crt`, caText)}>CA bundle</button>}
            {caText && <button className="btn btn-primary" onClick={() => save(`${base}-fullchain.pem`, `${crt}\n${caText}`)}>Full chain (.pem)</button>}
          </div>
          <div style={{ marginTop: 14, color: 'var(--muted)', fontSize: 12 }}>
            The private key is not here. It never left the machine that made the CSR.
          </div>
        </>
      ) : (
        <div className="callout warn">
          TheSSLStore has not issued a certificate for this order yet, so there is nothing to download.
          Finish domain validation first.
        </div>
      ))}
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
          onClick={() => onSubmit('change_approver', { domain, new_email: email, new_method: 'Email' }, 'Approver changed — a new email has been sent.')}>Change and send</button>
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
/**
 * Complete an order that was bought in the TheSSLStore dashboard but never
 * configured. Collects what /order/neworder needs, then hands it to the server,
 * which presents the order's own enrolment token — so nothing here can spend a
 * partner's balance, and the token itself never reaches the browser.
 */
function GenerateModal({ order, onClose, onDone }) {
  const [domain, setDomain] = useState(order.common_name || '');
  const [mode, setMode] = useState('generate');       // generate | paste
  const [csr, setCsr] = useState('');
  const [server, setServer] = useState('Other');
  const [dcv, setDcv] = useState('email');
  const [email, setEmail] = useState('');
  const [sans, setSans] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');

  // The CA decides which addresses it will accept, and the list can include
  // WHOIS contacts we could never guess. Ask the API rather than assuming the
  // usual five.
  const [approvers, setApprovers] = useState([]);
  useEffect(() => {
    const d = domain.trim();
    if (!d || dcv !== 'email') return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await api('action', { method: 'POST', body: {
          action: 'approver_list', order_id: order.gg_order_id,
          domain: d, product_code: order.raw?.ProductCode || '',
        } });
        const list = (r?.result?.ApproverEmailList || r?.result?.ApproverEmails || [])
          .map(x => (typeof x === 'string' ? x : x.Email || x.ApproverEmail)).filter(Boolean);
        if (!cancelled && list.length) setApprovers(list);
      } catch { /* fall back to the conventional five below */ }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [domain, dcv, order]);

  const fallbackApprovers = domain
    ? ['admin', 'administrator', 'hostmaster', 'postmaster', 'webmaster'].map(u => `${u}@${domain.replace(/^\*\./, '')}`)
    : [];
  const approverChoices = approvers.length ? approvers : fallbackApprovers;

  const ready = domain.trim() && first.trim() && last.trim() && email.trim()
    && (mode === 'generate' || csr.includes('CERTIFICATE REQUEST'));

  async function submit() {
    setBusy(true); setErr('');
    try {
      let finalCsr = csr;
      if (mode === 'generate') {
        setStep('Generating your key and CSR in this browser…');
        const bundle = await generateCsrBundle({ commonName: domain.trim() });
        await bundle.downloadZip();
        finalCsr = bundle.csrPem;
      }
      setStep('Submitting to TheSSLStore…');
      await api('generate', {
        method: 'POST',
        body: {
          order_id: order.gg_order_id,
          common_name: domain.trim(),
          csr: finalCsr,
          webserver_type: server,
          dcv_method: dcv,
          approver_email: email.trim(),
          dns_names: sans.split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
          admin: {
            first_name: first.trim(), last_name: last.trim(), phone: phone.trim(),
            email: email.trim(), organization: org.trim(),
          },
        },
      });
      onDone(mode === 'generate'
        ? 'Submitted. Your private key downloaded as a ZIP — it was never sent to us and cannot be recovered here.'
        : 'Submitted to TheSSLStore. Validation is next.');
    } catch (e) { setErr(e.message); }
    setBusy(false); setStep('');
  }

  return (
    <Modal
      title="Generate certificate"
      sub="This order is paid for but never configured. Filling this in completes it — no new charge."
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !ready} onClick={submit}>
          {busy ? <><span className="spin" /> {step || 'Working'}</> : 'Generate certificate'}
        </button>
      </>}>
      {err && <div className="err">{err}</div>}

      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Domain (common name)</span>
        <input className="mono" value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" />
        <div className="hint">Use <span className="mono">*.example.com</span> for a wildcard, if this product allows one.</div>
      </div>

      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Certificate signing request</span>
        <div className="tabs" style={{ marginBottom: 10 }}>
          <button type="button" className={mode === 'generate' ? 'on' : ''} onClick={() => setMode('generate')}>Generate for me</button>
          <button type="button" className={mode === 'paste' ? 'on' : ''} onClick={() => setMode('paste')}>Paste my own</button>
        </div>
        {mode === 'generate'
          ? <div className="callout">A 2048-bit key and CSR are made in your browser. The private key downloads as a ZIP and is never sent to us — we could not recover it for you, so keep it safe.</div>
          : <textarea className="mono" value={csr} onChange={e => setCsr(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE REQUEST-----" style={{ minHeight: 120 }} />}
      </div>

      <div className="row-2">
        <div className="field" style={{ maxWidth: 'none' }}>
          <span className="lbl">Web server</span>
          <select className="sel" value={server} onChange={e => setServer(e.target.value)}>
            {['Other', 'Apache', 'Nginx', 'IIS', 'Tomcat', 'cPanel', 'Plesk', 'AWS', 'Exchange'].map(x => <option key={x}>{x}</option>)}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 'none' }}>
          <span className="lbl">Validation method</span>
          <select className="sel" value={dcv} onChange={e => setDcv(e.target.value)}>
            <option value="email">Email to approver</option>
            <option value="http">HTTP file</option>
            <option value="https">HTTPS file</option>
            <option value="cname">CNAME record</option>
          </select>
        </div>
      </div>

      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">{dcv === 'email' ? 'Approver email' : 'Contact email'}</span>
        {dcv === 'email' && approverChoices.length
          ? <select className="sel" value={email} onChange={e => setEmail(e.target.value)}>
              <option value="">Choose an address…</option>
              {approverChoices.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          : <input type="email" value={email} onChange={e => setEmail(e.target.value)} />}
        {dcv === 'email' && <div className="hint">The CA only accepts these fixed addresses at the domain.</div>}
      </div>

      <div className="row-2">
        <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">First name</span>
          <input value={first} onChange={e => setFirst(e.target.value)} /></div>
        <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Last name</span>
          <input value={last} onChange={e => setLast(e.target.value)} /></div>
      </div>
      <div className="row-2">
        <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Phone</span>
          <input value={phone} onChange={e => setPhone(e.target.value)} /></div>
        <div className="field" style={{ maxWidth: 'none' }}><span className="lbl">Organisation</span>
          <input value={org} onChange={e => setOrg(e.target.value)} /></div>
      </div>

      <div className="field" style={{ maxWidth: 'none' }}>
        <span className="lbl">Additional domains <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)', fontWeight: 400 }}>— optional</span></span>
        <input className="mono" value={sans} onChange={e => setSans(e.target.value)} placeholder="www.example.com, mail.example.com" />
        <div className="hint">Only if this product includes SAN capacity.</div>
      </div>
    </Modal>
  );
}
