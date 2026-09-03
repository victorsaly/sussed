import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoveStack, toIsoDate } from '@sussed/core';
import { formatMs } from '@sussed/player';
import { usePlayer, usePlayerStats, useSyncOnFocus } from '@sussed/player/react';
import { ClaimPrompt, Sheet, StatsSheet } from '@sussed/ui';
import { share } from '@sussed/share';
import { buildTopology, cycleBridge, emptyCounts, isSolved, type Puzzle } from './engine';
import { nextDeduction } from './solver';
import { Board } from './Board';
import bundle from '../public/puzzles.json';

const GAME = 'bridges';
const LABEL = 'Bridges';
const URL = 'https://bridgesdaily.com';

interface Bundle {
  epoch: string;
  start: string;
  puzzles: Puzzle[];
}

function puzzleForToday(): Puzzle {
  const data = bundle as Bundle;
  const today = toIsoDate();
  return data.puzzles.find((p) => p.date === today) ?? (data.puzzles[0] as Puzzle);
}

export function App() {
  const player = usePlayer();
  const stats = usePlayerStats();
  useSyncOnFocus();

  // The board is built synchronously from a bundled file. There is no loading
  // state anywhere in this component, and there must never be one.
  const puzzle = useMemo(puzzleForToday, []);
  const topo = useMemo(() => buildTopology(puzzle), [puzzle]);

  const [counts, setCounts] = useState(() => emptyCounts(topo));
  const stack = useRef(new MoveStack<{ edgeId: number; from: number; to: number }>());
  const [, forceRender] = useState(0);
  const [hints, setHints] = useState(0);
  const [hintEdge, setHintEdge] = useState<number | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [claim, setClaim] = useState<string | null>(null);
  const [claimDismissed, setClaimDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const solved = useMemo(() => isSolved(puzzle, topo, counts), [puzzle, topo, counts]);

  // Pause the clock when the tab is hidden, so a solve time means time spent.
  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') stack.current.pause();
      else stack.current.start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const cycle = useCallback(
    (edgeId: number) => {
      if (solved) return;
      setCounts((current) => {
        const next = cycleBridge(puzzle, topo, current, edgeId);
        if (!next) return current;
        stack.current.push({
          edgeId,
          from: current[edgeId] ?? 0,
          to: next[edgeId] ?? 0,
        });
        return next;
      });
      setHintEdge(null);
      setHintText(null);
    },
    [puzzle, topo, solved],
  );

  const undo = useCallback(() => {
    const move = stack.current.undo();
    if (!move) return;
    setCounts((current) => {
      const next = current.slice();
      next[move.edgeId] = move.from;
      return next;
    });
    forceRender((n) => n + 1);
  }, []);

  const takeHint = useCallback(() => {
    const step = nextDeduction(puzzle, topo, counts);
    if (!step) {
      setHintText('Nothing is forced right now — you may need to look further ahead.');
      return;
    }
    setHints((h) => h + 1);
    setHintEdge(step.edgeId);
    setHintText(step.reason);
  }, [puzzle, topo, counts]);

  // On solve: record locally, then decide whether this is the claim moment.
  useEffect(() => {
    if (!solved || recorded) return;
    setRecorded(true);
    stack.current.pause();
    const ms = stack.current.elapsedMs;

    void (async () => {
      await player.record({
        // A daily's puzzle id IS its date. A level game passes a level id here
        // and mode: 'level' — same record, same table, same sync.
        puzzle: puzzle.date,
        mode: 'daily',
        solved: true,
        ms,
        moves: stack.current.length,
        hints,
        difficulty: puzzle.difficulty,
      });
      if (!claimDismissed) {
        const offer = await player.claimOffer({ ms });
        if (offer) setClaim(offer);
      }
    })();
  }, [solved, recorded, player, puzzle, hints, claimDismissed]);

  const onShare = async (): Promise<void> => {
    const result = await share({
      game: GAME,
      gameLabel: LABEL,
      number: puzzle.number,
      solved,
      ms: stack.current.elapsedMs,
      moves: stack.current.length,
      hints,
      difficulty: puzzle.difficulty,
      streak: stats?.streak.current ?? 0,
      url: URL,
    });
    if (result === 'copied') setToast('Copied');
    if (result === 'failed') setToast("Couldn't copy that");
    setTimeout(() => setToast(null), 1600);
  };

  return (
    <div className="s-shell">
      <header className="s-bar">
        <div>
          <h1 className="s-title">Bridges</h1>
          <div className="s-sub">
            #{puzzle.number} · {['', 'Mon–Tue', 'Midweek', 'Weekend'][puzzle.difficulty]}
          </div>
        </div>
        <span className="s-spacer" />
        {stats && stats.streak.current > 0 && (
          <div className="s-sub" title="Current streak">
            {stats.streak.current}🔥
          </div>
        )}
        <button className="s-icon" onClick={() => setShowRules(true)} aria-label="How it works">
          ?
        </button>
        <button className="s-icon" onClick={() => setShowStats(true)} aria-label="Your record">
          ▤
        </button>
      </header>

      <main style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
        <Board
          puzzle={puzzle}
          topo={topo}
          counts={counts}
          onCycle={cycle}
          solved={solved}
          hintEdge={hintEdge}
        />
      </main>

      {hintText && (
        <p className="hint-text" role="status">
          {hintText}
        </p>
      )}

      <footer className="s-bar">
        {solved ? (
          <>
            <div>
              <div className="s-title" style={{ color: 'var(--s-accent)' }}>
                Sussed it
              </div>
              <div className="s-sub">
                {formatMs(stack.current.elapsedMs)} · {stack.current.length} moves
                {hints > 0 ? ` · ${hints} hint${hints > 1 ? 's' : ''}` : ''}
              </div>
            </div>
            <span className="s-spacer" />
            <button className="s-btn s-btn-primary" onClick={() => void onShare()}>
              Share
            </button>
          </>
        ) : (
          <>
            <button className="s-btn" onClick={undo} disabled={!stack.current.canUndo}>
              Undo
            </button>
            <button className="s-btn s-btn-quiet" onClick={takeHint}>
              Nudge
            </button>
            <span className="s-spacer" />
            <div className="s-sub">{formatMs(stack.current.elapsedMs)}</div>
          </>
        )}
      </footer>

      {toast && <div className="toast">{toast}</div>}

      <StatsSheet open={showStats} onClose={() => setShowStats(false)} stats={stats} />

      <Sheet open={showRules} onClose={() => setShowRules(false)} title="How it works">
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--s-ink-2)', lineHeight: 1.7 }}>
          <li>Join the islands with bridges. Tap one island, then another.</li>
          <li>Tap the same pair again for a double bridge, once more to clear it.</li>
          <li>Each island's number is exactly how many bridges must touch it.</li>
          <li>Bridges run straight, and never cross each other.</li>
          <li>When you're done, every island must be part of one single network.</li>
        </ul>
        <p style={{ color: 'var(--s-ink-3)', fontSize: 14, marginBottom: 0 }}>
          Monday and Tuesday puzzles never need a guess — they can always be worked out.
        </p>
      </Sheet>

      {claim && (
        <ClaimPrompt
          player={player}
          message={claim}
          onDone={() => {
            setClaim(null);
            setClaimDismissed(true);
          }}
        />
      )}
    </div>
  );
}
