import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Dashboard from './DashTss.jsx';

/** Loads the order book, then hands it to the dashboard. */
export default function Certificates({ profile }) {
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
    try { await api('sync', { method: 'POST' }); await load(); }
    catch (e) { setErr(e.message); }
    setSyncing(false);
  }

  if (err) return <div className="gp-body"><div className="err">{err}</div></div>;
  if (!data) return <div className="loading" style={{ paddingTop: 60 }}><span className="spin" /> Loading your certificates…</div>;

  return (
    <div className="gp-body">
      <Dashboard
        data={data}
        orders={data.orders || []}
        syncing={syncing}
        onSync={sync}
        q={q}
        setQ={setQ}
        profile={profile}
        onChanged={load}
      />
    </div>
  );
}
