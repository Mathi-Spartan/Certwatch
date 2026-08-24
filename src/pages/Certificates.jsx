import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { getPlatform } from '../lib/platform.js';
import DashGg from './DashGg.jsx';
import DashTss from './DashTss.jsx';

/**
 * Thin router: loads the order book, then hands off to the platform's own
 * dashboard. The two dashboards are deliberately different — GoGetSSL is
 * reconciliation-forward, TheSSLStore is lifecycle-forward — because the two
 * platforms behave differently enough that one layout would serve neither well.
 */
export default function Certificates({ profile }) {
  const platform = profile.platform || getPlatform() || 'gogetssl';
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [syncing, setSyncing] = useState(false);

  async function load() {
    try { setData(await api('orders')); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function sync() {
    setSyncing(true); setErr('');
    try { await api('sync', { method: 'POST', platform }); await load(); }
    catch (e) { setErr(e.message); }
    setSyncing(false);
  }

  if (err) return <div className="gp-body"><div className="err">{err}</div></div>;
  if (!data) return <div className="loading" style={{ paddingTop: 60 }}><span className="spin" /> Loading your certificates…</div>;

  const orders = data.orders || [];
  const shared = { data, orders, syncing, onSync: sync, q, setQ, profile, onChanged: load };

  return (
    <div className="gp-body">
      {platform === 'thesslstore' ? <DashTss {...shared} /> : <DashGg {...shared} />}
    </div>
  );
}
