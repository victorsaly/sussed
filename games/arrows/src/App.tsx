import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MoveStack, allLevels, dailyUnlocked, toIsoDate, type LevelRef } from '@sussed/core';
import {
  HintLadder,
  StuckWatcher,
  formatMs,
  hintBudget,
  type HintSource,
  type HintView,
} from '@sussed/player';
import { usePlayer, usePlayerStats, useSyncOnFocus } from '@sussed/player/react';
import { ClaimPrompt, CourseDots, GameLogo, NudgeButton, Sheet, StatsSheet, type DotState } from '@sussed/ui';
import { share } from '@sussed/share';
import { initialState, isSolved, liveCount, tap, type Puzzle, type State } from './engine';
import { createHintSource } from './hints';
import { ARROWS_LEVELS, levelPuzzle, teachingFor } from './levels';
import { Board } from './Board';
import bundle from '../public/puzzles.json';

const GAME = 'arrows';
const LABEL = 'Arrows Out';
const URL = 'https://arrowsout.com';

/** How long the flip waits between taps when it plays a solve back. */
const REPLAY_STEP_MS = 240;

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

const LEVELS = allLevels(ARROWS_LEVELS);

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

  // Opens on the first level, dealt before anything else has resolved.
  // Progress lives in IndexedDB and takes a few milliseconds to read; the board
  // is on screen and playable throughout, and there is no loading state.
  const [sitting, setSitting] = useState<Sitting>(() => levelSitting(LEVELS[0]!));
  const [resolved, setResolved] = useState(false);
  const [solvedLevels, setSolvedLevels] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    void player.progress(ARROWS_LEVELS).then((progress) => {
      if (!alive) return;
      const next = LEVELS.find((l) => !progress.solved.has(l.id));
      setSolvedLevels(progress.solved);
      setSitting(next ? levelSitting(next) : dailySitting());
      setResolved(true);
    });
    return () => {
      alive = false;
    };
  }, [player]);

  const puzzle = sitting.puzzle;
  const [state, setState] = useState<State>(() => initialState(puzzle));
  const [misses, setMisses] = useState(0);
  const [miss, setMiss] = useState<number | null>(null);
  const [exiting, setExiting] = useState<number | null>(null);

  const stack = useRef(new MoveStack<{ index: number }>());
  const stuck = useRef(new StuckWatcher());
  const [, force] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [claim, setClaim] = useState<string | null>(null);
  const [claimDismissed, setClaimDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [offered, setOffered] = useState(false);
  const [chain, setChain] = useState<number[]>([]);

  /* The flip. `replaying` runs the queue; `restoreTo` is the position to put
     the player back in afterwards on a level, and null on a daily where the
     reveal ends the attempt. */
  const [replaying, setReplaying] = useState(false);
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const restoreTo = useRef<State | null>(null);
  const queue = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const solved = useMemo(() => isSolved(state), [state]);
  const left = liveCount(state);
  // Not while the last path is still threading out — the ghost board appearing
  // mid-animation would cut the one moment the game is worth watching.
  const finished = solved && exiting === null && !replaying;

  // Fresh board, fresh everything.
  useEffect(() => {
    setState(initialState(puzzle));
    stack.current = new MoveStack();
    stuck.current = new StuckWatcher();
    setMisses(0);
    setMiss(null);
    setExiting(null);
    setRecorded(false);
    setChain([]);
    setOffered(false);
    setReplaying(false);
    setRevealNote(null);
    restoreTo.current = null;
    queue.current = [];
    if (timer.current) clearTimeout(timer.current);
  }, [puzzle]);

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  /* ------------------------------------------------------------- hints */
  const liveState = useRef(state);
  liveState.current = state;

  const source: HintSource<number> = useMemo(
    () => createHintSource(puzzle, () => liveState.current),
    [puzzle],
  );

  const ladder = useRef<HintLadder<number> | null>(null);
  const budget = hintBudget(sitting.mode, sitting.levelIndex, puzzle.difficulty);
  if (!ladder.current) ladder.current = new HintLadder(source, budget);
  useEffect(() => {
    ladder.current = new HintLadder(source, budget);
    force((n) => n + 1);
    // A new board gets a new ladder. The source reads state through a ref, so
    // unlike the deduction games it never needs rebuilding mid-board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  const hints: HintView<number> = ladder.current.view;

  // Offered, never forced: after a quiet spell the button becomes visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (!solved && stuck.current.isStuck && !offered) setOffered(true);
    }, 2000);
    return () => clearInterval(t);
  }, [solved, offered]);

  /* ------------------------------------------------------------- moves */
  const exit = useCallback((index: number) => {
    setState((current) => {
      const move = tap(puzzle, current, index);
      return move && move.kind === 'exit' ? move.state : current;
    });
    setExiting(index);
  }, [puzzle]);

  const onTap = useCallback(
    (index: number) => {
      if (solved || replaying || exiting !== null) return;
      stack.current.start();

      const move = tap(puzzle, state, index);
      if (!move) return;

      if (move.kind === 'miss') {
        // A miss must be visible. It is also the entire score, so it is the one
        // thing here that must never be swallowed.
        setMisses((n) => n + 1);
        setMiss(index);
        setTimeout(() => setMiss(null), 420);
        stuck.current.touch();
        return;
      }

      stack.current.push({ index });
      exit(index);
      stuck.current.touch();
      setOffered(false);
      setChain([]);
      ladder.current!.clear();
      force((n) => n + 1);
    },
    [puzzle, state, solved, replaying, exiting, exit],
  );

  const onExitDone = useCallback(() => {
    setExiting(null);
    if (!replaying) return;
    const next = queue.current.shift();
    if (next !== undefined) {
      timer.current = setTimeout(() => exit(next), REPLAY_STEP_MS);
      return;
    }
    // Replay finished.
    setReplaying(false);
    const restore = restoreTo.current;
    if (restore) {
      setState(restore);
      restoreTo.current = null;
      setRevealNote('That is the order. Now do it yourself.');
    }
  }, [replaying, exit]);

  const nudge = useCallback(() => {
    const { apply } = ladder.current!.press();
    setOffered(false);
    stuck.current.touch();
    setChain(ladder.current!.view.chain.map((s) => s.move));
    if (apply !== undefined) {
      stack.current.push({ index: apply });
      exit(apply);
    }
    force((n) => n + 1);
  }, [exit]);

  /**
   * Turn the board over.
   *
   * A solved Arrows board is an empty board, so there is no picture to flip to —
   * the answer here is the order, and the order is what gets played back. On a
   * level the board is put back where it was afterwards, because the player
   * still has to make the moves for the level to count. On a daily it plays out
   * and the attempt ends unsolved: revealed is never solved.
   */
  const flip = useCallback(() => {
    const revelation = ladder.current!.revealAnswer();
    if (!revelation || revelation.kind !== 'replay' || revelation.moves.length === 0) return;

    stack.current.pause();
    restoreTo.current = sitting.mode === 'level' ? state : null;
    setChain([]);
    setOffered(false);
    setReplaying(true);
    setRevealNote(null);

    const [first, ...rest] = revelation.moves;
    queue.current = rest;
    exit(first as number);
    force((n) => n + 1);
  }, [sitting.mode, state, exit]);

  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') stack.current.pause();
      else if (!replaying) stack.current.start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [replaying]);

  /* ------------------------------------------------------------ on solve */
  useEffect(() => {
    if (!solved || recorded || !resolved || replaying) return;

    // A board cleared by the flip is not a solve. On a daily that means the
    // attempt is recorded as unsolved and nothing reaches the streak.
    const byReveal = hints.revealed && sitting.mode === 'daily';
    setRecorded(true);
    stack.current.pause();
    const ms = stack.current.elapsedMs;

    void (async () => {
      await player.record({
        puzzle: sitting.puzzleId,
        mode: sitting.mode,
        solved: !byReveal,
        ms,
        moves: stack.current.length,
        hints: hints.used,
        difficulty: puzzle.difficulty,
      });
      if (byReveal) {
        setRevealNote('Revealed. Nothing recorded today — the next one is tomorrow.');
        return;
      }
      if (sitting.mode === 'level') {
        setSolvedLevels((prev) => new Set(prev).add(sitting.puzzleId));
      }
      if (!claimDismissed) {
        const offer = await player.claimOffer({ ms });
        if (offer) setClaim(offer);
      }
    })();
  }, [
    solved,
    recorded,
    resolved,
    replaying,
    player,
    sitting,
    puzzle,
    hints.used,
    hints.revealed,
    claimDismissed,
  ]);

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

  const courseDone = stats
    ? dailyUnlocked({ solved: new Set(), furthestIndex: 0, levelsSolved: stats.levelsSolved })
    : false;

  const caption = useMemo((): string | null => {
    if (replaying) return 'Watch the order.';
    if (revealNote) return revealNote;
    if (hints.message) return hints.message;
    if (solved) return null;
    if (sitting.mode === 'level') return null;
    if (misses === 0 && stack.current.length === 0) return 'Tap a path that has a clear run to the edge.';
    return null;
  }, [replaying, revealNote, hints.message, solved, sitting.mode, misses]);

  const revealedThis = hints.revealed;

  /* What the finished board says. A cleared Arrows board is empty, so this is
     the only thing telling the player what just happened — it says what they
     did, not "well done". */
  const byReveal = revealedThis && sitting.mode === 'daily';
  const levelNumber = (sitting.levelIndex ?? 0) + 1;

  const doneHeadline = byReveal
    ? 'Revealed'
    : sitting.mode === 'level'
      ? levelNumber === LEVELS.length
        ? 'Course complete'
        : `Level ${levelNumber} cleared`
      : misses === 0
        ? 'Cleared, no misses'
        : 'Cleared';

  const doneDetail = [
    `${puzzle.paths.length} paths`,
    formatMs(stack.current.elapsedMs),
    misses === 0 ? 'no misses' : `${misses} miss${misses === 1 ? '' : 'es'}`,
    hints.used > 0 ? `${hints.used} nudge${hints.used === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const doneAside = ((): string | null => {
    if (byReveal) return 'Nothing recorded today. The next one is tomorrow.';
    if (sitting.mode === 'daily') {
      const streak = stats?.streak.current ?? 0;
      return streak > 1
        ? `That is ${streak} days in a row.`
        : 'A new board tomorrow.';
    }
    if (levelNumber === LEVELS.length) {
      return 'That is the course. The daily is open now — a new board every day.';
    }
    if (levelNumber >= 10) return 'The daily is open now.';
    return `${LEVELS.length - levelNumber} to go before the daily opens.`;
  })();

  return (
    <div className="s-shell">
      <header className="s-bar">
        <GameLogo game="arrows" title="" />
        <div>
          <h1 className="s-title">{sitting.mode === 'daily' ? LABEL : sitting.title}</h1>
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
        />
      )}

      {sitting.teaches && <p className="teach">{sitting.teaches}</p>}

      <main style={{ display: 'grid', placeItems: 'center', flex: 1, minHeight: 0 }}>
        <Board
          puzzle={puzzle}
          state={finished ? initialState(puzzle) : state}
          exiting={exiting}
          onExitDone={onExitDone}
          onTap={onTap}
          look={hints.focus as number | null}
          chain={chain}
          miss={miss}
          ghost={finished}
        />
      </main>

      {finished && (
        <div className="s-done">
          <div className="headline">{doneHeadline}</div>
          <div className="detail">{doneDetail}</div>
          {doneAside && <p className="aside">{doneAside}</p>}
        </div>
      )}

      {!finished && (
        <p className="progress-line" aria-live="polite">
          {left} path{left === 1 ? '' : 's'} left
          {misses > 0 ? ` · ${misses} miss${misses === 1 ? '' : 'es'}` : ''}
        </p>
      )}

      <p className="hint-text" role="status">
        {caption ?? ''}
      </p>

      <footer className="s-bar">
        {finished ? (
          <>
            {/* The panel above already says what happened, so this is only the
                way onward. Saying it twice made the win read as boilerplate. */}
            <span className="s-spacer" />
            {sitting.mode === 'level' ? (
              <button className="s-btn s-btn-primary" onClick={advance}>
                {levelNumber === LEVELS.length ? 'Play the daily →' : 'Next level →'}
              </button>
            ) : (
              !revealedThis && (
                <button className="s-btn s-btn-primary" onClick={() => void onShare()}>
                  Share
                </button>
              )
            )}
          </>
        ) : (
          <>
            <NudgeButton hints={hints} offered={offered} onPress={nudge} />
            {/* Rung five. It appears only once the ladder is spent — a give-up
                button next to a fresh board changes what the game is asking. */}
            {hints.canReveal && !replaying && (
              <button className="s-btn" onClick={flip} disabled={replaying}>
                Show me
              </button>
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
          <li>Tap a path and it threads out of the board, head first.</li>
          <li>It can only go if the straight run from its arrowhead to the edge is clear.</li>
          <li>The tail does not matter. However long it is, it follows the head.</li>
          <li>Tap one that cannot go and nothing moves — that is a miss.</li>
          <li>Clear the board. Order never matters; finding the free one does.</li>
        </ul>
        <p style={{ color: 'var(--s-ink-3)', fontSize: 14, marginBottom: 0 }}>
          {courseDone
            ? 'Every board comes apart. You can never get stuck, only slower.'
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
