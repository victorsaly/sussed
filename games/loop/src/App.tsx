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
  courseSkipped,
  resumeCourse,
  skipCourse,
} from '@sussed/player';
import { usePlayer, usePlayerStats, useSyncOnFocus } from '@sussed/player/react';
import { ClaimPrompt, GameLogo, NudgeButton, Sheet, StatsSheet, CourseDots, type DotState, gameHref, hubHref } from '@sussed/ui';
import { share } from '@sussed/share';
import {
  buildTopology,
  CROSS,
  cycleEdge,
  emptyMarks,
  isSolved,
  LINE,
  progress,
  type Mark,
  type Marks,
  type Puzzle,
} from './engine';
import {
  deductionChain,
  describeFocus,
  nextDeduction,
  solve,
  type Deduction,
  type HintFocus,
} from './solver';
import { LOOP_LEVELS, levelPuzzle, teachingFor } from './levels';
import { Board } from './Board';
import bundle from '../public/puzzles.json';

const GAME = 'loop';
const LABEL = 'Loop';
/** The keyword domain this game will get. Not bought yet, so the share
    card uses wherever the game is actually being served from. */
const PLANNED_DOMAIN = 'https://loopdaily.com';
void PLANNED_DOMAIN;

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

const LEVELS = allLevels(LOOP_LEVELS);

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
  const [solvedLevels, setSolvedLevels] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    void player.progress(LOOP_LEVELS).then((progress) => {
      if (!alive) return;
      const next = LEVELS.find((l) => !progress.solved.has(l.id));
      setSolvedLevels(progress.solved);
      // Someone who has said they already know the game goes straight to the
      // daily; the course is still there, one tap away, for when they want it.
      setSitting(courseSkipped(GAME) || !next ? dailySitting() : levelSitting(next));
      setResolved(true);
    });
    return () => {
      alive = false;
    };
  }, [player]);

  const puzzle = sitting.puzzle;
  const topo = useMemo(() => buildTopology(puzzle), [puzzle]);
  const [marks, setMarks] = useState(() => emptyMarks(topo));

  const stack = useRef(new MoveStack<{ edge: number; from: Mark; to: Mark }>());
  const stuck = useRef(new StuckWatcher());
  const [, force] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [claim, setClaim] = useState<string | null>(null);
  const [claimDismissed, setClaimDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /* The flip: the finished board laid over the player's own. Their position
     is untouched underneath — on a level they turn it back and play it. */
  const [shown, setShown] = useState<Marks | null>(null);
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [offered, setOffered] = useState(false);
  const [chain, setChain] = useState<Deduction[]>([]);

  const solved = useMemo(() => isSolved(puzzle, topo, marks), [puzzle, topo, marks]);
  const prog = useMemo(() => progress(puzzle, topo, marks), [puzzle, topo, marks]);

  // Fresh board, fresh everything.
  useEffect(() => {
    setMarks(emptyMarks(topo));
    stack.current = new MoveStack();
    stuck.current = new StuckWatcher();
    setRecorded(false);
    setChain([]);
    setOffered(false);
    setShown(null);
    setRevealNote(null);
  }, [topo]);

  /* ------------------------------------------------------------- hints */
  const source: HintSource<Deduction> = useMemo(
    () => ({
      next: () => {
        const d = nextDeduction(puzzle, topo, marks);
        return d ? toStep(d) : null;
      },
      chain: (max) => deductionChain(puzzle, topo, marks, max).map(toStep),
      describeFocus: (f) => describeFocus(puzzle, f as HintFocus),
      // A deduction board has an answer you can look at, so the flip is
      // the finished grid rather than Arrows' replay of an order.
      reveal: () => ({ kind: 'solved' as const, board: solve(puzzle, 1, topo).solution ?? null }),
    }),
    [puzzle, topo, marks],
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
    if (d.edge < 0) return;
    setMarks((m) => {
      const next = m.slice();
      next[d.edge] = d.value === 'line' ? LINE : d.value === 'empty' ? CROSS : 0;
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
    (edge: number) => {
      if (solved) return;
      stack.current.start();
      setMarks((current) => {
        const next = cycleEdge(current, edge);
        stack.current.push({ edge, from: current[edge] ?? 0, to: next[edge] ?? 0 });
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

  /**
   * Turn the board over. Offered only once the hint ladder is spent — a
   * give-up control next to a fresh board changes what the game is asking of
   * you. On a level it is a look, and their own position is untouched
   * underneath. On a daily it ends the attempt, recorded honestly as unsolved,
   * because revealed is never solved.
   */
  const flip = useCallback(() => {
    const revelation = ladder.current!.revealAnswer();
    if (!revelation || revelation.kind !== 'solved') return;
    const answer = revelation.board as Marks | null;
    if (!answer) return;
    setShown(answer);
    setChain([]);
    setOffered(false);
    stack.current.pause();
    if (sitting.mode === 'daily') {
      setRevealNote('Revealed. Nothing recorded today — the next one is tomorrow.');
    }
    force((n) => n + 1);
  }, [sitting.mode]);

  /** Back to their own board, exactly as they left it. */
  const unflip = useCallback(() => {
    setShown(null);
    setRevealNote('That is the answer. Now do it yourself.');
    stack.current.start();
  }, []);

  const undo = useCallback(() => {
    const move = stack.current.undo();
    if (!move) return;
    setMarks((current) => {
      const next = current.slice();
      next[move.edge] = move.from;
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
        // A board finished after the flip on a daily is not a solve.
        solved: !(hints.revealed && sitting.mode === 'daily'),
        ms,
        moves: stack.current.length,
        hints: hints.used,
        difficulty: puzzle.difficulty,
      });
      if (sitting.mode === 'level') {
        setSolvedLevels((prev) => new Set(prev).add(sitting.puzzleId));
      }
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

  /** Back to a level already cleared — the dots are the only way in. */
  const goToLevel = useCallback((index: number) => {
    const ref = LEVELS[index];
    if (ref) setSitting(levelSitting(ref));
  }, []);

  /** Straight to today's board, and it stays that way on this device. */
  const goToDaily = useCallback(() => {
    skipCourse(GAME);
    setSitting(dailySitting());
    // A preference that changes the screen and says nothing looks like a
    // one-off jump. Saying it out loud is the difference between a setting
    // someone trusts and one they press again every visit to be sure.
    setToast('Course skipped. The daily opens first from now on.');
    setTimeout(() => setToast(null), 2600);
  }, []);

  /** Back into the course, at the first level not yet cleared. */
  const goToCourse = useCallback(() => {
    resumeCourse(GAME);
    setToast('Back on the course.');
    setTimeout(() => setToast(null), 2000);
    const next = LEVELS.find((l) => !solvedLevels.has(l.id)) ?? LEVELS[0];
    if (next) setSitting(levelSitting(next));
  }, [solvedLevels]);

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
      url: gameHref(import.meta.env.BASE_URL),
    });
    setToast(result === 'copied' ? 'Copied' : result === 'failed' ? "Couldn't copy that" : null);
    setTimeout(() => setToast(null), 1600);
  };

  const courseDone = stats ? dailyUnlocked({ solved: new Set(), furthestIndex: 0, levelsSolved: stats.levelsSolved }) : false;

  // What is left, in one line. During the course the chapter text does this job.
  const readout = useMemo((): { text: string; warn: boolean } | null => {
    if (solved || sitting.mode === 'level') return null;
    if (prog.forks > 0) {
      return { text: `The line branches at ${prog.forks === 1 ? 'a dot' : `${prog.forks} dots`}. The loop never forks or crosses itself.`, warn: true };
    }
    if (prog.cluesOver > 0) {
      return { text: `${prog.cluesOver} number${prog.cluesOver === 1 ? ' has' : 's have'} too many lines.`, warn: true };
    }
    if (prog.closed > 0 && prog.cluesMet < prog.cluesTotal) {
      return { text: 'A loop has closed with numbers still unmet. There is only ever one loop.', warn: true };
    }
    if (prog.closed > 0 && prog.pieces > 1) {
      return { text: 'A loop has closed but there are lines outside it. There is only ever one loop.', warn: true };
    }
    const parts = [`${prog.cluesMet} of ${prog.cluesTotal} numbers met`];
    if (prog.pieces > 1) parts.push(`${prog.pieces} separate lines`);
    return { text: parts.join(' · '), warn: false };
  }, [solved, sitting.mode, prog]);

  // A quiet caption for the first minute of a daily. Never a modal, never a wall.
  const caption = useMemo((): string | null => {
    if (shown) return 'This is the answer. Turn it back when you have seen enough.';
    if (revealNote) return revealNote;
    if (hints.message) return hints.message;
    if (solved || sitting.mode === 'level') return null;
    if (prog.lines === 0) return 'Tap between two dots to draw a line. Tap again for a cross, once more to clear.';
    if (prog.lines <= 2) return 'Faint crosses mark sides the lines you have drawn already rule out.';
    return null;
  }, [shown, revealNote, hints.message, solved, sitting.mode, prog.lines]);

  return (
    <div className="s-shell">
      <header className="s-bar">
        <a
          className="s-home"
          href={hubHref(import.meta.env.BASE_URL)}
          aria-label="All SUSSED games"
          title="All games"
        >
          <GameLogo game="slitherlink" title="" />
        </a>
        <div>
          <h1 className="s-title">{sitting.mode === 'daily' ? LABEL : sitting.title}</h1>
          <div className="s-sub">
            {sitting.mode === 'daily'
              ? `#${puzzle.number} · ${puzzle.w}×${puzzle.h} · ${['', 'Mon–Tue', 'Midweek', 'Weekend'][puzzle.difficulty]}`
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

      {sitting.mode === 'level' && (
        <CourseDots
          states={LEVELS.map((l): DotState =>
            l.id === sitting.puzzleId ? 'here' : solvedLevels.has(l.id) ? 'done' : 'todo',
          )}
          label={`Level ${(sitting.levelIndex ?? 0) + 1} of ${LEVELS.length}`}
          onPick={goToLevel}
        />
      )}

      {sitting.teaches && <p className="teach">{sitting.teaches}</p>}

      {/* One way past the course, and one way back into it. Both stay out of
          the way: the board is what you came for. */}
      {sitting.mode === 'level' ? (
        <button className="s-quiet" onClick={goToDaily}>
          Played before? Skip the course
        </button>
      ) : solvedLevels.size < LEVELS.length ? (
        <button className="s-quiet" onClick={goToCourse}>
          Back to the course
        </button>
      ) : null}


      <main style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
        <Board
          puzzle={puzzle}
          topo={topo}
          marks={shown ?? marks}
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
            {/* Rung five. It appears only once the ladder is spent. */}
            {shown ? (
              <button className="s-btn" onClick={unflip}>
                Hide
              </button>
            ) : (
              hints.canReveal && (
                <button className="s-btn" onClick={flip}>
                  Show me
                </button>
              )
            )}
            <span className="s-spacer" />
            <div className="s-sub">{formatMs(stack.current.elapsedMs)}</div>
          </>
        )}
      </footer>

      {toast && <div className="toast">{toast}</div>}

      <StatsSheet open={showStats} onClose={() => setShowStats(false)} stats={stats} />

      <Sheet open={showRules} onClose={() => setShowRules(false)} title="How it works">
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--s-ink-2)', lineHeight: 1.7 }}>
          <li>Draw one closed loop along the grid lines, joining dot to dot.</li>
          <li>A number says how many of that cell's four sides the loop uses. Cells without a number can have any.</li>
          <li>The loop never crosses or branches, and there is only one of it.</li>
          <li>Tap between two dots for a line. Tap again for a cross meaning "not here", once more to clear.</li>
          <li>Faint crosses appear on their own on sides that can no longer be part of the loop.</li>
          <li>A number fades once it has its lines.</li>
                  <li>Out of nudges and still stuck? &ldquo;Show me&rdquo; turns the board over.</li>
</ul>
        <p style={{ color: 'var(--s-ink-3)', fontSize: 14, marginBottom: 0 }}>
          {courseDone
            ? 'Monday to Thursday puzzles never need a guess — they can always be worked out.'
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
    target: d.edge >= 0 ? d.edge : null,
    reason: d.reason,
    kind: d.value === 'line' ? 'place' : 'rule-out',
  };
}
