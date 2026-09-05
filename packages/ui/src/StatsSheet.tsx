import { formatMs, type GameStats, type LeaderboardEntry } from '@sussed/player';
import { Sheet } from './Sheet';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function StatsSheet({
  open,
  onClose,
  stats,
  board,
  boardNote,
}: {
  open: boolean;
  onClose: () => void;
  stats: GameStats | null;
  /** today's leaderboard, when there is a service to fetch one from */
  board?: LeaderboardEntry[];
  /** why there is no board, said plainly rather than left blank */
  boardNote?: string | null;
}) {
  if (!stats) return null;
  const peak = Math.max(1, ...stats.byWeekday);

  return (
    <Sheet open={open} onClose={onClose} title="Your record">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <Figure label="Played" value={stats.played} />
        <Figure label="Solved" value={stats.solved} />
        <Figure label="Streak" value={stats.streak.current} accent={stats.streak.current > 0} />
        <Figure label="Best run" value={stats.streak.best} />
      </div>

      <div className="s-sub" style={{ marginBottom: 8 }}>
        Solves by day
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 84, marginBottom: 22 }}>
        {stats.byWeekday.map((n, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center' }}>
            <div
              style={{
                height: Math.max(3, (n / peak) * 62),
                background: n > 0 ? 'var(--s-accent)' : 'var(--s-rule)',
                borderRadius: 1,
              }}
              title={`${n} on ${DAYS[i]}`}
            />
            <div className="s-sub" style={{ marginTop: 6 }}>
              {DAYS[i]}
            </div>
          </div>
        ))}
      </div>

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px' }}>
        <dt className="s-sub">Fastest</dt>
        <dd style={{ margin: 0 }}>{stats.bestMs === null ? '—' : formatMs(stats.bestMs)}</dd>
        <dt className="s-sub">Average</dt>
        <dd style={{ margin: 0 }}>{stats.averageMs === null ? '—' : formatMs(stats.averageMs)}</dd>
      </dl>

      {/* Today's board. It is either here or it says why not — a heading over
          an empty space tells nobody anything. */}
      <div className="s-sub" style={{ margin: '24px 0 8px' }}>
        Today&rsquo;s board
      </div>
      {board && board.length > 0 ? (
        <ol className="s-board">
          {board.map((e) => (
            <li key={`${e.rank}-${e.displayName}`} className={e.isYou ? 'is-you' : undefined}>
              <span className="rank">{e.rank}</span>
              <span className="who">{e.displayName}</span>
              <span className="time">{formatMs(e.ms)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="s-sub" style={{ margin: 0 }}>
          {boardNote ?? 'Nobody has finished today&rsquo;s puzzle yet.'}
        </p>
      )}
    </Sheet>
  );
}

function Figure({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--s-font-display)',
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          fontVariantNumeric: 'tabular-nums',
          color: accent ? 'var(--s-accent)' : 'var(--s-ink)',
        }}
      >
        {value}
      </div>
      <div className="s-sub">{label}</div>
    </div>
  );
}
