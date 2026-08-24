import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase.js';
import DashShell from './components/DashShell.jsx';
import Login from './pages/Login.jsx';
import SetPassword from './pages/SetPassword.jsx';
import Certificates from './pages/Certificates.jsx';
import Connection from './pages/Connection.jsx';
import SubUsers from './pages/SubUsers.jsx';
import Partners from './pages/Partners.jsx';
import Activity from './pages/Activity.jsx';
import { setPlatform } from './lib/platform.js';

const HOME = { admin: '/partners', partner: '/certificates', sub_user: '/certificates' };

function Shell() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const loc = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    let gone = false;
    (async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (gone) return;
      if (error || !data) setProfileError('Your account has no profile yet. Ask your provider to finish setting it up.');
      else {
        setProfile(data);
        // Model B: a partner/sub-user account is bound to one platform. That
        // binding — not a picker or switcher — decides everything downstream.
        if (data.platform) setPlatform(data.platform);
      }
    })();
    return () => { gone = true; };
  }, [session]);

  // Password recovery links land anywhere; always let that route through.
  if (loc.pathname === '/set-password') return <SetPassword />;

  if (session === undefined) return <div className="loading" style={{ paddingTop: 90 }}><span className="spin" /> Loading…</div>;
  if (!session) return <Login />;

  if (profileError) {
    return <div className="auth-wrap"><div className="auth-card">
      <h1>Almost there</h1><p className="sub">{profileError}</p>
      <button className="btn" style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div></div>;
  }
  if (!profile) return <div className="loading" style={{ paddingTop: 90 }}><span className="spin" /> Loading your account…</div>;

  // Platform is the account's own binding. Admin is platform-agnostic (null).
  const platform = profile.role === 'admin' ? null : profile.platform;

  // A partner/sub-user with no platform binding is a provisioning error.
  if (profile.role !== 'admin' && !platform) {
    return <div className="auth-wrap"><div className="auth-card">
      <h1>Account not set up</h1>
      <p className="sub">This account isn't linked to a platform yet. Ask your administrator to set it.</p>
      <button className="btn" style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div></div>;
  }

  const home = HOME[profile.role] || '/certificates';

  return (
    <DashShell profile={profile} platform={platform}>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/login" element={<Navigate to={home} replace />} />
        <Route path="/certificates" element={
          profile.role === 'admin' ? <Navigate to="/partners" replace /> : <Certificates profile={profile} />} />
        <Route path="/connection" element={
          profile.role === 'partner' ? <Connection /> : <Navigate to={home} replace />} />
        <Route path="/sub-users" element={
          profile.role === 'partner' ? <SubUsers /> : <Navigate to={home} replace />} />
        <Route path="/partners" element={
          profile.role === 'admin' ? <Partners /> : <Navigate to={home} replace />} />
        <Route path="/activity" element={
          profile.role === 'sub_user' ? <Navigate to={home} replace /> : <Activity profile={profile} />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </DashShell>
  );
}

export default function App() {
  return <BrowserRouter><Shell /></BrowserRouter>;
}
