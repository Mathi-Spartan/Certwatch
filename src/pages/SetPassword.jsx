import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

export default function SetPassword() {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  async function save(e) {
    e.preventDefault();
    if (password.length < 10) return setErr('Use at least 10 characters.');
    if (password !== again) return setErr('The two passwords do not match.');
    setBusy(true); setErr('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setErr(error.message); else nav('/');
    setBusy(false);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Set your password</h1>
        <p className="sub">Choose something you do not use anywhere else.</p>
        {err && <div className="err">{err}</div>}
        <form onSubmit={save}>
          <div className="field" style={{ maxWidth: 'none' }}>
            <span className="lbl">New password</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="field" style={{ maxWidth: 'none' }}>
            <span className="lbl">Repeat it</span>
            <input type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? <><span className="spin" /> Saving</> : 'Save password'}
          </button>
        </form>
      </div>
    </div>
  );
}
