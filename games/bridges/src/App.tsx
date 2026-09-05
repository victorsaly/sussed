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
  cycleEdge,
  isSolved,
  progress,
  removeEdge,
  type BoardState,
  type Puzzle,
} from './engine';
import { deductionChain, nextDeduction, solve, type Deduction } from './solver';
import { BRIDGES_LEVELS, levelPuzzle, teachingFor } from './levels';
import { Board } from './Board';
import bundle from '../public/puzzles.json';

const GAME = 'bridges';
const LABEL = 'Bridges';
/** The keyword domain this game will get. Not bought yet, so the share
    card uses wherever the game is actually being served from. */
const PLANNED_DOMAIN = 'https://bridgesdaily.com';
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
  const [solvedLevels, setSolvedLevels] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    void player.progress(BRIDGES_LEVELS).then((progress) => {
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
  /* The flip: the finished board, laid over the player's own. Their position is
     untouched underneath — on a level they turn it back and still play it. */
  const [shown, setShown] = useState<BoardState | null>(null);
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [offered, setOffered] = useState(false);
  const [chain, setChain] = useState<Deduction[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const solved = useMemo(() => isSolved(puzzle, topo, state.counts), [puzzle, topo, state.counts]);
  const prog = useMemo(() => progress(puzzle, topo, state.counts), [puzzle, topo, state.counts]);

  // Fresh board, fresh everything.
  useEffect(() => {
    setState({ counts: new Array<number>(topo.edges.length).fill(0), marks: new Set<number>() });
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
        const d = nextDeduction(puzzle, topo, state.counts, state.marks);
        return d ? toStep(d) : null;
      },
      chain: (max) => deductionChain(puzzle, topo, state.counts, state.marks, max).map(toStep),
      describeFocus: (f) => `the ${puzzle.islands[f as number]!.n}`,
      // Bridges has an answer you can look at, so the flip is a picture of the
      // finished board rather than Arrows' replay of an order.
      reveal: () => ({ kind: 'solved' as const, board: solve(puzzle, 1, topo).solution ?? null }),
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

  /**
   * Tapping a bridge takes one off. Separate from `cycle` on purpose: building
   * is taught as a cycle and must stay one, but unbuilding should not make you
   * walk the rest of the way round it.
   */
  const remove = useCallback(
    (edgeId: number) => {
      if (solved) return;
      stack.current.start();
      setState((current) => {
        const next = removeEdge(current, edgeId);
        if (!next) return current;
        stack.current.push({ edgeId, before: current });
        return next;
      });
      stuck.current.touch();
      setChain([]);
      ladder.current!.clear();
      force((n) => n + 1);
    },
    [solved],
  );

  /**
   * Turn the board over.
   *
   * Offered only once the hint ladder is spent — a give-up control next to a
   * fresh board changes what the game is asking of you. On a level it is a
   * look: the player's own position is untouched underneath and they turn it
   * back and play it themselves. On a daily it ends the attempt, recorded
   * honestly as unsolved, because revealed is never solved.
   */
  const flip = useCallback(() => {
    const revelation = ladder.current!.revealAnswer();
    if (!revelation || revelation.kind !== 'solved') return;
    const counts = revelation.board as number[] | null;
    if (!counts) return;
    setShown({ counts, marks: new Set<number>() });
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


  const levelNumber = (sitting.levelIndex ?? 0) + 1;
  /* What the finished board says. It names what was done rather than
     congratulating — "Sussed it" is the studio's one bit of celebration and it
     has to earn its place next to the numbers. */
  const doneHeadline = sitting.mode === 'level'
    ? levelNumber === LEVELS.length
      ? 'Course complete'
      : `Level ${levelNumber} cleared`
    : hints.used === 0
      ? 'Sussed it, unaided'
      : 'Sussed it';

  const doneDetail = [
    formatMs(stack.current.elapsedMs),
    `${stack.current.length} moves`,
    hints.used > 0 ? `${hints.used} nudge${hints.used === 1 ? '' : 's'}` : 'no nudges',
  ].join(' · ');

  const doneAside = ((): string | null => {
    if (sitting.mode === 'daily') {
      const streak = stats?.streak.current ?? 0;
      return streak > 1 ? `That is ${streak} days in a row.` : 'A new board tomorrow.';
    }
    if (levelNumber === LEVELS.length) {
      return 'That is the course. The daily is open now — a new board every day.';
    }
    return `${LEVELS.length - levelNumber} to go before the daily opens.`;
  })();

  /**
   * A leaderboard needs a name on the server, and the server is not deployed
   * yet — `canSync` is false until VITE_PLAYERS_URL is set, and `leaderboard()`
   * returns nothing without it. Offering the button anyway would be offering
   * something that cannot happen, so it appears only when there is a service to
   * appear on, and it opens the same naming flow the claim prompt uses.
   */
  const leaderboardOffer =
    solved && player.canSync && player.me.tier === 'anonymous'
      ? 'Put your name to this and you will show up on the board.'
      : null;

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
    if (prog.numbersMet && prog.pieces > 1) {
      return {
        text: `Every number is met, but the bridges form ${prog.pieces} separate pieces. The lighter islands are cut off.`,
        warn: true,
      };
    }
    const parts = [`${prog.placed} of ${prog.total} bridges`];
    parts.push(
      prog.islandsOver > 0
        ? `${prog.islandsOver} island${prog.islandsOver === 1 ? ' has' : 's have'} too many`
        : `${prog.islandsLeft} island${prog.islandsLeft === 1 ? '' : 's'} left`,
    );
    return { text: parts.join(' · '), warn: prog.islandsOver > 0 };
  }, [solved, sitting.mode, prog]);

  // A quiet caption for the first minute of a daily. Never a modal, never a wall.
  const caption = useMemo((): string | null => {
    if (shown) return 'This is the answer. Turn it back when you have seen enough.';
    if (revealNote) return revealNote;
    if (hints.message) return hints.message;
    if (solved || sitting.mode === 'level') return null;
    if (prog.placed === 0) return selected === null ? 'Tap an island to start.' : 'Now tap an island in line with it.';
    if (prog.placed <= 2) return 'Hold an island to see how many bridges it could still take.';
    return null;
  }, [shown, revealNote, hints.message, solved, sitting.mode, prog.placed, selected]);

  return (
    <div className="s-shell">
      <header className="s-bar">
        <a
          className="s-home"
          href={hubHref(import.meta.env.BASE_URL)}
          aria-label="All SUSSED games"
          title="All games"
        >
          <GameLogo game="bridges" title="" />
        </a>
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
          state={shown ?? state}
          onCycle={cycle}
          onRemove={remove}
          onSelect={setSelected}
          solved={solved}
          look={hints.focus as number | null}
          target={hints.target as number | null}
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

      {solved && (
        <div className="s-done">
          <div className="headline">{doneHeadline}</div>
          <div className="detail">{doneDetail}</div>
          {doneAside && <p className="aside">{doneAside}</p>}
        </div>
      )}

      <footer className="s-bar">
        {solved ? (
          <>
            {/* The panel above says what happened. Repeating it here made a win
                read as boilerplate, so this is only the way onward. */}
            {leaderboardOffer && (
              <button className="s-btn" onClick={() => setClaim(leaderboardOffer)}>
                Leaderboard
              </button>
            )}
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
          <li>Join the islands. Tap one, then another.</li>
          <li>Tap the same pair again for a double, once more to mark it ✗, once more to clear.</li>
          <li>Tap a bridge you have already drawn to take one off.</li>
          <li>An island greyed out while you have one selected cannot take a bridge yet.</li>
          <li>Each island's number is exactly how many bridges must touch it.</li>
          <li>Once you start on an island, its big number is what it still needs. The small one is its total.</li>
          <li>Hold an island to see, in grey, how many bridges it could still take each way.</li>
          <li>Bridges run straight, and never cross.</li>
          <li>Everything must end up in one connected network.</li>
                  <li>Out of nudges and still stuck? &ldquo;Show me&rdquo; turns the board over.</li>
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
