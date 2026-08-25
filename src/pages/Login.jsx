import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

/**
 * Certwatch landing + sign-in.
 *
 * Left panel pitches the product; right panel signs people in by role. Every
 * account is a TheSSLStore account — whether it runs against the live or the
 * sandbox API is decided by the credentials the partner saves after signing
 * in, not here.
 */

const ROLES = [
  { id: 'admin', label: 'Master Admin', blurb: 'Manage every partner account',
    icon: <svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6l-8-4z"/><path d="M9 12l2 2 4-4"/></svg> },
  { id: 'partner', label: 'Partner Admin', blurb: 'Your orders, sub-users and assignments',
    icon: <svg viewBox="0 0 24 24"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></svg> },
  { id: 'user', label: 'End User', blurb: 'Only the certificates assigned to you',
    icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg> },
];

export default function Login() {
  const [chosen, setChosen] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

  function pick(roleId) {
    setChosen({ role: roleId });
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

  return (
    <div className="land">
      <div className="land-left">
        <div className="land-brand">
          <span className="land-mark"><svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 6a3 3 0 0 1 3 3v1h1v6H8v-6h1v-1a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v1h2v-1a1 1 0 0 0-1-1z"/></svg></span>
          <span><b>Certwatch</b><small>Certificate operations</small></span>
        </div>

        <div className="land-pitch">
          <span className="land-eyebrow">TheSSLStore — live &amp; sandbox</span>
          <h1>Every certificate,<br /><span className="thin">from issue to expiry,</span><br />in one console.</h1>
          <p className="land-lead">Your entire TheSSLStore order book in one call — active, pending, cancelled — with each certificate's lifecycle in plain view.</p>

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
        {!chosen ? (
          <>
            <div className="land-rhead"><h2>Sign in</h2><p>Choose your role to continue.</p></div>
            {ROLES.map(r => (
              <div key={r.id} className="land-role">
                <div className="lr-main" onClick={() => pick(r.id)}>
                  <div className="lr-ic">{r.icon}</div>
                  <div className="lr-tx"><b>{r.label}</b><span>{r.blurb}</span></div>
                  <span className="lr-arrow"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
                </div>
              </div>
            ))}
            <div className="land-rfoot">Accounts are created by your provider. Need access? <a href="mailto:admin@certwatch.app">Ask to be invited →</a></div>
          </>
        ) : (
          <>
            <button className="land-back" onClick={() => setChosen(null)}>← Back to roles</button>
            <div className="land-rhead">
              <h2>{chosenRole.label}</h2>
              <p>
                {chosen.role === 'admin'
                  ? 'Sign in to manage partner accounts.'
                  : 'Sign in to your Certwatch account.'}
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
