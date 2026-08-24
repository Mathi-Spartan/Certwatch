import { lifecycle, fmt } from '../lib/lifecycle.js';

/**
 * The signature element. The solid segment is the certificate live today;
 * everything after it is one block per reissue the order still has to absorb,
 * each sized by the validity cap in force on the day it would be issued.
 */
export default function Rail({ order, micro, showEnds }) {
  const lc = lifecycle(order);
  if (!lc) return micro ? <div className="rail micro" /> : null;

  const pct = (x) => ((x - lc.issued) / (lc.orderEnd - lc.issued)) * 100;
  const now = new Date();
  const tp = Math.min(Math.max(pct(now), 0), 100);

  return (
    <div>
      <div className={`rail${micro ? ' micro' : ''}`}>
        {lc.segs.map((s, i) => (
          <div
            key={i}
            className={`rail-seg ${s.live ? 'live' : (i % 2 ? 'f1' : 'f0')}`}
            style={{ width: `${((s.to - s.from) / (lc.orderEnd - lc.issued) * 100).toFixed(3)}%` }}
          />
        ))}
        {now > lc.issued && now < lc.orderEnd && (
          <div className="rail-today" style={{ left: `${tp.toFixed(2)}%` }} />
        )}
      </div>
      {showEnds && (
        <>
          <div className="rail-ends">
            <span className="mono">{fmt(lc.issued)}</span>
            <span className="mono r">order ends {fmt(lc.orderEnd)}</span>
          </div>
          <div className="rail-note">
            <span className="rail-key"><i style={{ background: 'var(--blue-deep)' }} /> certificate live today</span>
            <span className="rail-key">
              <i style={{ background: '#c2d5e8' }} />
              {lc.reissues} reissue{lc.reissues === 1 ? '' : 's'} left before the order ends
            </span>
          </div>
        </>
      )}
    </div>
  );
}
