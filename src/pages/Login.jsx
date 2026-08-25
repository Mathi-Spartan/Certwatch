import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

/**
 * Certwatch landing + sign-in.
 *
 * One login for everyone. There is no role picker: the account's role lives in
 * the profiles table, and App.jsx routes on it the moment the session resolves
 * — admin to /partners, partner and sub-user to /certificates. Asking someone
 * to declare their role first was never load-bearing; sign-in ignored the pick
 * entirely, so all it did was imply that choosing wrong would fail.
 *
 * Every account is a TheSSLStore account. Whether it runs against the live or
 * the sandbox API is decided by the credentials the partner saves after signing
 * in, not here.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);

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
        <div className="land-rhead">
          <h2>Sign in</h2>
          <p>One login for everyone. Your account decides what you see.</p>
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

        <div className="land-rfoot">Accounts are created by your provider. Need access? <a href="mailto:admin@certwatch.app">Ask to be invited →</a></div>
      </div>
    </div>
  );
}
