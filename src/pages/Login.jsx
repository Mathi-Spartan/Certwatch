import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { setPlatform } from '../lib/platform.js';

/**
 * Certwatch landing + sign-in.
 *
 * Left panel pitches the product; right panel signs people in by role. Master
 * Admin signs in directly; Partner Admin and End User first pick a platform.
 *
 * The platform pick drives one of two models, switchable here purely so the
 * behaviour can be compared before one is chosen:
 *   A one login. The pick sets which dashboard you land on; a person who
 *     resells through both stores sees both under a single account.
 *   B separate accounts. The pick scopes the login to that platform.
 * The real auth call is identical either way (same signInWithPassword); the
 * difference is only what we remember about the chosen platform afterwards.
 */

const ROLES = [
  { id: 'admin', label: 'Master Admin', blurb: 'Manage partners across both platforms', platforms: false,
    icon: <svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6l-8-4z"/><path d="M9 12l2 2 4-4"/></svg> },
  { id: 'partner', label: 'Partner Admin', blurb: 'Your orders, sub-users and assignments', platforms: true,
    icon: <svg viewBox="0 0 24 24"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></svg> },
  { id: 'user', label: 'End User', blurb: 'Only the certificates assigned to you', platforms: true,
    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg> },
];

const PLATS = [
  { id: 'gogetssl', name: 'GoGetSSL', sub: 'V1 + V2 reseller account', dot: 'gg' },
  { id: 'thesslstore', name: 'TheSSLStore', sub: 'Live or sandbox account', dot: 'tss' },
];

export default function Login() {
  const [model, setModel] = useState('A');
  const [role, setRole] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  function pick(roleId, platformId) {
    if (platformId) setPlatform(platformId);
    setChosen({ role: roleId, platform: platformId || null });
    setErr('');
  }

  async function signIn(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr('That email and password do not match an account.');
    setBusy(false);
  }

  async function reset() {
    if (!email.trim()) return setErr('Enter your email first, then choose Set or reset password.');
    setBusy(true); setErr('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/set-password`,
    });
    if (error) setErr(error.message); else setSent(true);
    setBusy(false);
  }

  const chosenRole = chosen && ROLES.find(r => r.id === chosen.role);
  const chosenPlat = chosen?.platform && PLATS.find(p => p.id === chosen.platform);

  return (
    <div className="land">
      <div className="land-left">
        <div className="land-brand">
          <span className="land-mark"><svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 6a3 3 0 0 1 3 3v1h1v6H8v-6h1v-1a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v1h2v-1a1 1 0 0 0-1-1z"/></svg></span>
          <span><b>Certwatch</b><small>Certificate operations</small></span>
        </div>

        <div className="land-pitch">
          <span className="land-eyebrow">GoGetSSL · TheSSLStore — one console</span>
          <h1>Every certificate,<br /><span className="thin">from issue to expiry,</span><br />in one console.</h1>
          <p className="land-lead">One place to watch every reseller order across both platforms — active, pending, cancelled — with each certificate's lifecycle in plain view.</p>

          <div className="land-proof">
            <div className="lp-head"><span className="lp-domain">freecerts.site</span><span className="lp-tag">RAPIDSSL · ACTIVE</span></div>
            <div className="lp-rail"><div className="lp-fill" /><div className="lp-tick" style={{ left: '33%' }} /><div className="lp-tick" style={{ left: '66%' }} /></div>
            <div className="lp-legend"><span>issued 10 May 2026</span><span>ends 10 May 2027</span></div>
            <div className="lp-grid">
              <div><div className="k">Reissue in</div><div className="v warn">47d</div></div>
              <div><div className="k">Authority</div><div className="v">RapidSSL</div></div>
              <div><div className="k">Order ID</div><div className="v">3590098</div></div>
            </div>
          </div>

          <div className="land-assure">
            <span><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>Never spends your balance</span>
            <span><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>Credentials encrypted</span>
            <span><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>Every action audited</span>
          </div>
        </div>

        <div className="land-foot">© 2026 Certwatch · concept build</div>
      </div>

      <div className="land-right">
        <div className="land-preview">
          <span>Preview mechanics:</span>
          <button className={model === 'A' ? 'on' : ''} onClick={() => { setModel('A'); setChosen(null); setRole(null); }}>A · one login</button>
          <button className={model === 'B' ? 'on' : ''} onClick={() => { setModel('B'); setChosen(null); setRole(null); }}>B · per-platform</button>
        </div>

        {!chosen ? (
          <>
            <div className="land-rhead"><h2>Sign in</h2><p>Choose your role to continue.</p></div>
            {ROLES.map(r => (
              <div key={r.id} className={`land-role${role === r.id ? ' open' : ''}`}>
                <div className="lr-main" onClick={() => (r.platforms ? setRole(role === r.id ? null : r.id) : pick(r.id))}>
                  <div className="lr-ic">{r.icon}</div>
                  <div className="lr-tx"><b>{r.label}</b><span>{r.blurb}</span></div>
                  <span className="lr-arrow"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
                </div>
                {r.platforms && (
                  <div className="lr-pop"><div className="lr-pop-in">
                    {PLATS.map(p => (
                      <div key={p.id} className="lr-plat" onClick={() => pick(r.id, p.id)}>
                        <span className={`pd ${p.dot}`} />
                        <span><b>{p.name} {r.id === 'partner' ? 'partner' : 'end user'}</b><small>{p.sub}</small></span>
                        <span className="go"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
                      </div>
                    ))}
                  </div></div>
                )}
              </div>
            ))}
            <div className="land-rfoot">Accounts are created by your provider. Need access? <a href="mailto:admin@certwatch.app">Ask to be invited →</a></div>
          </>
        ) : (
          <>
            <button className="land-back" onClick={() => { setChosen(null); setRole(null); }}>← Back to roles</button>
            <div className="land-rhead">
              <h2>{chosenRole.label}</h2>
              <p>
                {chosenPlat
                  ? (model === 'A'
                      ? <>Signing in — you'll land on your <b>{chosenPlat.name}</b> dashboard, and can switch platforms once inside.</>
                      : <>Signing in to your <b>{chosenPlat.name}</b> account. This login only sees {chosenPlat.name}.</>)
                  : 'Sign in to manage partners across both platforms.'}
              </p>
            </div>

            {err && <div className="err">{err}</div>}
            {sent && <div className="ok-note">Check your inbox for a link to set a password.</div>}

            <form onSubmit={signIn}>
              <div className="field" style={{ maxWidth: 'none' }}>
                <span className="lbl">Email</span>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus />
              </div>
              <div className="field" style={{ maxWidth: 'none' }}>
                <span className="lbl">Password</span>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
                {busy ? <><span className="spin" /> Signing in</> : 'Sign in'}
              </button>
            </form>
            <button className="btn btn-sm" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={reset} disabled={busy}>
              Set or reset password
            </button>
          </>
        )}
      </div>
    </div>
  );
}
