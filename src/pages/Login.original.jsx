import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

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
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="gp-brand-mark"><svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 6a3 3 0 0 1 3 3v1h1v6H8v-6h1v-1a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v1h2v-1a1 1 0 0 0-1-1z"/></svg></div>
          <b style={{ fontSize: 15 }}>Certwatch</b>
        </div>
        <h1>Sign in</h1>
        <p className="sub">Certificate management for GoGetSSL and TheSSLStore partners.</p>

        {err && <div className="err">{err}</div>}
        {sent && <div className="ok-note">Check your inbox for a link to set a password.</div>}

        <form onSubmit={signIn}>
          <div className="field" style={{ maxWidth: 'none' }}>
            <span className="lbl">Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
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
        <p style={{ marginTop: 18, marginBottom: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Accounts are created by your provider. If you do not have one yet, ask them to invite you.
        </p>
      </div>
    </div>
  );
}
