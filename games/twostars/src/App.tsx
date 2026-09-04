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
import { ClaimPrompt, GameLogo, NudgeButton, Sheet, StatsSheet } from '@sussed/ui';
import { share } from '@sussed/share';
import { buildUnits, cycleCell, DOT, emptyCells, isSolved, progress, STAR, type Mark, type Puzzle } from './engine';
import { deductionChain, describeFocus, nextDeduction, type Deduction, type HintFocus } from './solver';
import { TWOSTARS_LEVELS, levelPuzzle, teachingFor } from './levels';
import { Board } from './Board';
import bundle from '../public/puzzles.json';

const GAME = 'twostars';
const LABEL = 'Two Stars';
const URL = 'https://twostars.com';

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

const LEVELS = allLevels(TWOSTARS_LEVELS);

function levelSitting(ref: LevelRef): Sitting {
  const t = teachingFor(ref.id);
  return {
    mode: 'level',
    puzzleId: ref.id,
    puzzle: levelPuzzle(ref.id)!,
    levelIndex: ref.index,
    teaches: t?.teaches ?? null,
    title: t?.title ?? LABEL,
  };
}

function dailySitting(): Sitting {
  const data = bundle as Bundle;
  const today = toIsoDate();
  const puzzle = data.puzzles.find((p) => p.date === today) ?? (data.puzzles[0] as Puzzle);
  return { mode: 'daily', puzzleId: puzzle.date, puzzle, levelIndex: null, teaches: null, title: LABEL };
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
    void player.progress(TWOSTARS_LEVELS).then((progress) => {
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
  const units = useMemo(() => buildUnits(puzzle), [puzzle]);
  const [cells, setCells] = useState(() => emptyCells(puzzle));

  const stack = useRef(new MoveStack<{ cell: number; from: Mark; to: Mark }>());
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

  const solved = useMemo(() => isSolved(puzzle, units, cells), [puzzle, units, cells]);
  const prog = useMemo(() => progress(puzzle, units, cells), [puzzle, units, cells]);

  // Fresh board, fresh everything.
  useEffect(() => {
    setCells(emptyCells(puzzle));
    stack.current = new MoveStack();
    stuck.current = new StuckWatcher();
    setRecorded(false);
    setChain([]);
    setOffered(false);
  }, [puzzle, units]);

  /* ------------------------------------------------------------- hints */
  const source: HintSource<Deduction> = useMemo(
    () => ({
      next: () => {
        const d = nextDeduction(puzzle, units, cells);
        return d ? toStep(d) : null;
      },
      chain: (max) => deductionChain(puzzle, units, cells, max).map(toStep),
      describeFocus: (f) => describeFocus(f as HintFocus),
    }),
    [puzzle, units, cells],
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
  (ladder.current as unknown as { source: HintSource<Deduction> }).source = source;

  const hints: HintView<Deduction> = ladder.current.view;

  useEffect(() => {
    const t = setInterval(() => {
      if (!solved && stuck.current.isStuck && !offered) setOffered(true);
    }, 2000);
    return () => clearInterval(t);
  }, [solved, offered]);

  const applyDeduction = useCallback((d: Deduction) => {
    if (d.cell < 0) return;
    setCells((c) => {
      const next = c.slice();
      next[d.cell] = d.value === 'star' ? STAR : d.value === 'empty' ? DOT : 0;
      return next;
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
    (cell: number) => {
      if (solved) return;
      stack.current.start();
      setCells((current) => {
        const next = cycleCell(current, cell);
        stack.current.push({ cell, from: current[cell] ?? 0, to: next[cell] ?? 0 });
        return next;
      });
      stuck.current.touch();
      setOffered(false);
      setChain([]);
      ladder.current!.clear();
      force((n) => n + 1);
    },
    [solved],
  );

  const undo = useCallback(() => {
    const move = stack.current.undo();
    if (!move) return;
    setCells((current) => {
      const next = current.slice();
      next[move.cell] = move.from;
      return next;
    });
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

  // What is left, in one line. During the course the chapter text does this job.
  const readout = useMemo((): { text: string; warn: boolean } | null => {
    if (solved || sitting.mode === 'level') return null;
    if (prog.touching > 0) {
      return { text: `${prog.touching === 1 ? 'Two stars are' : 'Some stars are'} touching. Stars never touch, not even at a corner.`, warn: true };
    }
    if (prog.over > 0) {
      return { text: `${prog.over} line${prog.over === 1 ? ' has' : 's have'} more than ${puzzle.stars} stars.`, warn: true };
    }
    const left = prog.regionsLeft;
    return { text: `${prog.placed} of ${prog.total} stars · ${left} region${left === 1 ? '' : 's'} left`, warn: false };
  }, [solved, sitting.mode, prog, puzzle.stars]);

  // A quiet caption for the first minute of a daily. Never a modal, never a wall.
  const caption = useMemo((): string | null => {
    if (hints.message) return hints.message;
    if (solved || sitting.mode === 'level') return null;
    if (prog.placed === 0) return 'Tap a cell to place a star. Tap again for a dot, once more to clear.';
    if (prog.placed === 1) return 'The faint dots are cells that can no longer hold a star.';
    return null;
  }, [hints.message, solved, sitting.mode, prog.placed]);

  return (
    <div className="s-shell">
      <header className="s-bar">
        <GameLogo game="starbattle" title="" />
        <div>
          <h1 className="s-title">{sitting.mode === 'daily' ? LABEL : sitting.title}</h1>
          <div className="s-sub">
            {sitting.mode === 'daily'
              ? `#${puzzle.number} · ${puzzle.n}×${puzzle.n} · ${['', 'Mon–Tue', 'Midweek', 'Weekend'][puzzle.difficulty]}`
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
          units={units}
          cells={cells}
          onCycle={cycle}
          solved={solved}
          look={(hints.focus as HintFocus | null) ?? null}
          target={(hints.target as number | null) ?? null}
          chain={chain}
        />
      </main>

      {readout && (
        <p className={readout.warn ? 'progress-line is-warn' : 'progress-line'} aria-live="polite">
          {readout.text}
        </p>
      )}

      <p className="hint-text" role="status">
        {caption ?? ''}
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
          <li>Place stars so that every row, every column and every outlined region has the same number, shown at the top.</li>
          <li>Stars never touch, not even at a corner.</li>
          <li>Tap a cell for a star. Tap again for a dot meaning "not here", once more to clear.</li>
          <li>Faint dots appear on their own in cells that can no longer hold a star.</li>
          <li>A region turns green once it has its stars.</li>
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
    focus: d.focus,
    target: d.cell >= 0 ? d.cell : null,
    reason: d.reason,
    kind: d.value === 'star' ? 'place' : 'rule-out',
  };
}
