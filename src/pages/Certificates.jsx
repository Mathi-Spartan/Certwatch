import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Dashboard from './DashTss.jsx';

/**
 * Loads the order book and keeps it fresh on its own.
 *
 * Why polling rather than a schedule: the Vercel Hobby plan runs cron at most
 * once a day, so /api/cron is a nightly floor, not a freshness mechanism. And
 * TheSSLStore has no webhooks — nothing can push a status change to us. So the
 * book is refreshed while somebody is actually looking at it, which is exactly
 * when freshness matters.
 *
 * Rules that keep this cheap:
 *   - polling stops when the tab is hidden, so a forgotten tab costs nothing
 *   - returning to the tab refreshes immediately, so it is never stale on sight
 *   - the server throttles automatic syncs per partner, so many open tabs still
 *     produce at most one call to TheSSLStore per interval
 *   - a background failure is swallowed; only an explicit Sync reports errors
 */
const POLL_MS = 60_000;

export default function Certificates({ profile }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try { setData(await api('orders')); } catch (e) { setErr(e.message); }
  }, []);

  /** Background refresh. Never throws, never shows an error, never blocks. */
  const autoSync = useCallback(async () => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    setAutoBusy(true);
    try {
      const r = await api('sync?auto=1', { method: 'POST' });
      // Only re-read the order book when the sync actually ran.
      if (!r?.skipped) await load();
    } catch {
      /* transient — the next tick tries again */
    }
    setAutoBusy(false);
    inFlight.current = false;
  }, [load]);

  useEffect(() => {
    let timer;
    (async () => { await load(); autoSync(); })();

    const tick = () => { autoSync(); };
    timer = setInterval(tick, POLL_MS);

    // Coming back to the tab should feel instant, not wait out the interval.
    const onVisible = () => { if (!document.hidden) autoSync(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load, autoSync]);

  async function sync() {
    setSyncing(true); setErr('');
    try { await api('sync', { method: 'POST' }); await load(); }
    catch (e) { setErr(e.message); }
    setSyncing(false);
  }

  if (err && !data) return <div className="gp-body"><div className="err">{err}</div></div>;
  if (!data) return <div className="loading" style={{ paddingTop: 60 }}><span className="spin" /> Loading your certificates…</div>;

  return (
    <div className="gp-body">
      {err && <div className="err">{err}</div>}
      <Dashboard
        data={data}
        orders={data.orders || []}
        syncing={syncing}
        autoBusy={autoBusy}
        onSync={sync}
        q={q}
        setQ={setQ}
        profile={profile}
        onChanged={load}
      />
    </div>
  );
}
