import { PLATFORMS, setPlatform } from '../lib/platform.js';

/** Shown after login until a platform is chosen. One tap, then the dashboard. */
export default function PlatformPicker({ profile, onPick }) {
  const choose = (id) => { setPlatform(id); onPick(id); };

  return (
    <div className="auth-wrap">
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div className="auth-brand" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <div className="gp-brand-mark"><svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 6a3 3 0 0 1 3 3v1h1v6H8v-6h1v-1a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v1h2v-1a1 1 0 0 0-1-1z"/></svg></div>
          <b style={{ fontSize: 16 }}>Certwatch</b>
        </div>
        <h1 style={{ textAlign: 'center', fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', margin: '0 0 6px' }}>
          Which platform?
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, margin: '0 0 26px' }}>
          {profile.role === 'sub_user'
            ? 'Choose the account you want to work in. You can switch any time.'
            : 'Choose which reseller account to work in. Connect either or both, and switch whenever you like.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {Object.values(PLATFORMS).map(p => (
            <button key={p.id} onClick={() => choose(p.id)} className="platform-card" style={{ '--pa': p.accent }}>
              <span className="platform-dot" />
              <span className="platform-name">{p.name}</span>
              <span className="platform-tag">{p.tag}</span>
              <span className="platform-go">Open →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
