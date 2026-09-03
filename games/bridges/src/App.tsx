import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoveStack, allLevels, dailyUnlocked, toIsoDate, type LevelRef } from '@sussed/core';
import {
  HintLadder,
  StuckWatcher,
  formatMs,
  hintBudget,
  type HintSource,
  type HintStep,
  type HintView,
} from '@sussed/player';
import { usePlayer, usePlayerStats, useSyncOnFocus } from '@sussed/player/react';
import { ClaimPrompt, NudgeButton, Sheet, StatsSheet } from '@sussed/ui';
import { share } from '@sussed/share';
import { buildTopology, cycleEdge, isSolved, type BoardState, type Puzzle } from './engine';
import { deductionChain, nextDeduction, type Deduction } from './solver';
import { BRIDGES_LEVELS, levelPuzzle, teachingFor } from './levels';
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

interface Sitting {
  mode: 'level' | 'daily';
  puzzleId: string;
  puzzle: Puzzle;
  levelIndex: number | null;
  teaches: string | null;
  title: string;
}

const LEVELS = allLevels(BRIDGES_LEVELS);

function levelSitting(ref: LevelRef): Sitting {
  const t = teachingFor(ref.id);
  return {
    mode: 'level',
    puzzleId: ref.id,
    puzzle: levelPuzzle(ref.id)!,
    levelIndex: ref.index,
    teaches: t?.teaches ?? null,
    title: t?.title ?? 'Bridges',
  };
}

function dailySitting(): Sitting {
  const data = bundle as Bundle;
  const today = toIsoDate();
  const puzzle = data.puzzles.find((p) => p.date === today) ?? (data.puzzles[0] as Puzzle);
  return {
    mode: 'daily',
    puzzleId: puzzle.date,
    puzzle,
    levelIndex: null,
    teaches: null,
    title: 'Bridges',
  };
}

export function App() {
  const player = usePlayer();
  const stats = usePlayerStats();
  useSyncOnFocus();

  // Opens on the first level. Progress lives in IndexedDB, so resolving where
  // the player actually got to takes a few milliseconds — the board is on
  // screen and playable the whole time, and there is no loading state.
  const [sitting, setSitting] = useState<Sitting>(() => levelSitting(LEVELS[0]!));
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let alive = true;
    void player.progress(BRIDGES_LEVELS).then((progress) => {
      if (!alive) return;
      const next = LEVELS.find((l) => !progress.solved.has(l.id));
      setSitting(next ? levelSitting(next) : dailySitting());
      setResolved(true);
    });
    return () => {
      alive = false;
    };
  }, [player]);

  const puzzle = sitting.puzzle;
  const topo = useMemo(() => buildTopology(puzzle), [puzzle]);
  const [state, setState] = useState<BoardState>(() => ({
    counts: new Array<number>(topo.edges.length).fill(0),
    marks: new Set<number>(),
  }));

  const stack = useRef(new MoveStack<{ edgeId: number; before: BoardState }>());
  const stuck = useRef(new StuckWatcher());
  const [, force] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [claim, setClaim] = useState<string | null>(null);
  const [claimDismissed, setClaimDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [offered, setOffered] = useState(false);
  const [chain, setChain] = useState<Deduction[]>([]);

  const solved = useMemo(() => isSolved(puzzle, topo, state.counts), [puzzle, topo, state.counts]);

  // Fresh board, fresh everything.
  useEffect(() => {
    setState({ counts: new Array<number>(topo.edges.length).fill(0), marks: new Set<number>() });
    stack.current = new MoveStack();
    stuck.current = new StuckWatcher();
    setRecorded(false);
    setChain([]);
    setOffered(false);
  }, [topo]);

  /* ------------------------------------------------------------- hints */
  const source: HintSource<Deduction> = useMemo(
    () => ({
      next: () => {
        const d = nextDeduction(puzzle, topo, state.counts, state.marks);
        return d ? toStep(d) : null;
      },
      chain: (max) => deductionChain(puzzle, topo, state.counts, state.marks, max).map(toStep),
      describeFocus: (f) => `the ${puzzle.islands[f as number]!.n}`,
    }),
    [puzzle, topo, state],
  );

  const ladder = useRef<HintLadder<Deduction> | null>(null);
  const budget = hintBudget(sitting.mode, sitting.levelIndex, puzzle.difficulty);
  if (!ladder.current) ladder.current = new HintLadder(source, budget);
  useEffect(() => {
    ladder.current = new HintLadder(source, budget);
    force((n) => n + 1);
    // A new board gets a new ladder; the source is rebuilt on every move and
    // must not reset the tier, so it is deliberately not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);
  // Keep the live source on the existing ladder without resetting its rung.
  (ladder.current as unknown as { source: HintSource<Deduction> }).source = source;

  const hints: HintView<Deduction> = ladder.current.view;

  // Offered, never forced: after a quiet spell the button becomes visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (!solved && stuck.current.isStuck && !offered) setOffered(true);
    }, 2000);
    return () => clearInterval(t);
  }, [solved, offered]);

  const applyDeduction = useCallback((d: Deduction) => {
    setState((s) => {
      if (d.value === 0) {
        const marks = new Set(s.marks);
        marks.add(d.edgeId);
        return { counts: s.counts, marks };
      }
      const counts = s.counts.slice();
      counts[d.edgeId] = d.value;
      return { counts, marks: s.marks };
    });
  }, []);

  const nudge = useCallback(() => {
    const { apply } = ladder.current!.press();
    setOffered(false);
    stuck.current.touch();
    setChain(ladder.current!.view.chain.map((s) => s.move));
    if (apply) applyDeduction(apply);
    force((n) => n + 1);
  }, [applyDeduction]);

  /* ------------------------------------------------------------- moves */
  const cycle = useCallback(
    (edgeId: number) => {
      if (solved) return;
      stack.current.start();
      setState((current) => {
        const next = cycleEdge(puzzle, topo, current, edgeId);
        if (!next) {
          shake();
          return current;
        }
        stack.current.push({ edgeId, before: current });
        return next;
      });
      stuck.current.touch();
      setOffered(false);
      setChain([]);
      ladder.current!.clear();
      force((n) => n + 1);
    },
    [puzzle, topo, solved],
  );

  const undo = useCallback(() => {
    const move = stack.current.undo();
    if (!move) return;
    setState(move.before);
    setChain([]);
    ladder.current!.clear();
    force((n) => n + 1);
  }, []);

  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') stack.current.pause();
      else stack.current.start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /* ------------------------------------------------------------ on solve */
  useEffect(() => {
    if (!solved || recorded || !resolved) return;
    setRecorded(true);
    stack.current.pause();
    const ms = stack.current.elapsedMs;

    void (async () => {
      await player.record({
        puzzle: sitting.puzzleId,
        mode: sitting.mode,
        solved: true,
        ms,
        moves: stack.current.length,
        hints: hints.used,
        difficulty: puzzle.difficulty,
      });
      if (!claimDismissed) {
        const offer = await player.claimOffer({ ms });
        if (offer) setClaim(offer);
      }
    })();
  }, [solved, recorded, resolved, player, sitting, puzzle, hints.used, claimDismissed]);

  const advance = useCallback(() => {
    const i = LEVELS.findIndex((l) => l.id === sitting.puzzleId);
    const next = i >= 0 ? LEVELS[i + 1] : undefined;
    setSitting(next ? levelSitting(next) : dailySitting());
  }, [sitting.puzzleId]);

  const onShare = async (): Promise<void> => {
    const result = await share({
      game: GAME,
      gameLabel: LABEL,
      number: puzzle.number,
      solved,
      ms: stack.current.elapsedMs,
      moves: stack.current.length,
      hints: hints.used,
      difficulty: puzzle.difficulty,
      streak: stats?.streak.current ?? 0,
      url: URL,
    });
    setToast(result === 'copied' ? 'Copied' : result === 'failed' ? "Couldn't copy that" : null);
    setTimeout(() => setToast(null), 1600);
  };

  const courseDone = stats ? dailyUnlocked({ solved: new Set(), furthestIndex: 0, levelsSolved: stats.levelsSolved }) : false;

  return (
    <div className="s-shell">
      <header className="s-bar">
        <div>
          <h1 className="s-title">{sitting.mode === 'daily' ? 'Bridges' : sitting.title}</h1>
          <div className="s-sub">
            {sitting.mode === 'daily'
              ? `#${puzzle.number} · ${['', 'Mon–Tue', 'Midweek', 'Weekend'][puzzle.difficulty]}`
              : `Level ${(sitting.levelIndex ?? 0) + 1} of ${LEVELS.length}`}
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

      {sitting.teaches && <p className="teach">{sitting.teaches}</p>}

      <main style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
        <Board
          puzzle={puzzle}
          topo={topo}
          state={state}
          onCycle={cycle}
          solved={solved}
          look={hints.focus as number | null}
          target={hints.target as number | null}
          chain={chain}
        />
      </main>

      <p className="hint-text" role="status">
        {solved ? '' : (hints.message ?? '')}
      </p>

      <footer className="s-bar">
        {solved ? (
          <>
            <div>
              <div className="s-title" style={{ color: 'var(--s-accent)' }}>
                Sussed it
              </div>
              <div className="s-sub">
                {formatMs(stack.current.elapsedMs)} · {stack.current.length} moves
                {hints.used > 0 ? ` · ${hints.used} nudge${hints.used > 1 ? 's' : ''}` : ' · unaided'}
              </div>
            </div>
            <span className="s-spacer" />
            {sitting.mode === 'level' ? (
              <button className="s-btn s-btn-primary" onClick={advance}>
                Next →
              </button>
            ) : (
              <button className="s-btn s-btn-primary" onClick={() => void onShare()}>
                Share
              </button>
            )}
          </>
        ) : (
          <>
            <button className="s-btn" onClick={undo} disabled={!stack.current.canUndo}>
              Undo
            </button>
            <NudgeButton hints={hints} offered={offered} onPress={nudge} />
            <span className="s-spacer" />
            <div className="s-sub">{formatMs(stack.current.elapsedMs)}</div>
          </>
        )}
      </footer>

      {toast && <div className="toast">{toast}</div>}

      <StatsSheet open={showStats} onClose={() => setShowStats(false)} stats={stats} />

      <Sheet open={showRules} onClose={() => setShowRules(false)} title="How it works">
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--s-ink-2)', lineHeight: 1.7 }}>
          <li>Join the islands. Tap one, then another.</li>
          <li>Tap the same pair again for a double, once more to mark it ✗, once more to clear.</li>
          <li>Each island's number is exactly how many bridges must touch it.</li>
          <li>Bridges run straight, and never cross.</li>
          <li>Everything must end up in one connected network.</li>
        </ul>
        <p style={{ color: 'var(--s-ink-3)', fontSize: 14, marginBottom: 0 }}>
          {courseDone
            ? 'Monday and Tuesday puzzles never need a guess — they can always be worked out.'
            : 'Finish the short course and the daily puzzle unlocks.'}
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

function toStep(d: Deduction): HintStep<Deduction> {
  return {
    move: d,
    focus: d.island,
    target: d.edgeId,
    reason: d.reason,
    kind: d.value === 0 ? 'rule-out' : 'place',
    label: d.value === 2 ? '×2' : undefined,
  };
}

/** An illegal move must fail visibly — a silent no-op teaches nothing. */
function shake(): void {
  const el = document.querySelector('.board');
  if (!el) return;
  el.classList.remove('s-shake');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('s-shake');
}
