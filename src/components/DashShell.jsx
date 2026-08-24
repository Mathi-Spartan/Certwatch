import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { PLATFORMS, setPlatform } from '../lib/platform.js';

const NAV = {
  admin:    [['/partners', 'Partners'], ['/activity', 'Activity log']],
  partner:  [['/certificates', 'Certificates'], ['/sub-users', 'Sub-users'], ['/connection', 'GoGetSSL connection'], ['/activity', 'Activity log']],
  sub_user: [['/certificates', 'My certificates']],
};

export default function DashShell({ profile, children, platform, onPlatformChange, connectedPlatforms }) {
  const nav = useNavigate();
  const items = NAV[profile.role] || [];
  const canSwitch = !connectedPlatforms || connectedPlatforms.length !== 1;

  const roleLabel = profile.role === 'admin' ? 'Administrator'
    : profile.role === 'partner' ? 'Partner' : 'Sub-user';

  return (
    <div className="gp-shell">
      <aside className="gp-side">
        <div className="gp-brand">
          <div className="gp-brand-mark">
            <svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm0 6a3 3 0 0 1 3 3v1h1v6H8v-6h1v-1a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v1h2v-1a1 1 0 0 0-1-1z"/></svg>
          </div>
          <div className="gp-brand-name">Certwatch</div>
        </div>
        {platform && (
          <div className="plat-switch" role="group" aria-label="Platform">
            {Object.values(PLATFORMS).map(p => (
              <button key={p.id}
                className={`${platform === p.id ? 'on' : ''}${p.id === 'thesslstore' ? ' tss' : ''}`}
                onClick={() => { if (platform !== p.id) { setPlatform(p.id); onPlatformChange?.(p.id); } }}>
                {p.name}
              </button>
            ))}
          </div>
        )}
        <nav className="gp-nav">
          {items.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'on' : '')}>
              <span className="dot" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="gp-side-foot">
          <div className="gp-who">
            <b>{profile.full_name || profile.email}</b>
            <span>{roleLabel}</span>
          </div>
          <button
            className="btn btn-sm"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
            onClick={async () => { await supabase.auth.signOut(); nav('/login'); }}
          >Sign out</button>
        </div>
      </aside>
      <main className="gp-main"><div className="gp-wrap">{children}</div></main>
    </div>
  );
}
