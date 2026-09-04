/**
 * The Arrows solver — and it is barely a solver, which is the point.
 *
 * The game is confluent: removing a path never blocks another one, because
 * every cell it frees stays free. So unthreading greedily until nothing more
 * can go either clears the board or proves it cannot be cleared. No search, no
 * backtracking, no node budget. Milliseconds, not minutes.
 *
 * That makes this file's real job MEASUREMENT rather than solution. If any
 * order works, difficulty cannot live in the order — it lives in how hard it is
 * to see which arrowhead is free. So the numbers that matter are how few
 * choices the board offers at its tightest moment, and how often it narrows to
 * exactly one. Those are what the generator tunes against and what CI checks.
 */

import {
  canGo,
  freePaths,
  initialState,
  isSolved,
  liveCount,
  occupancy,
  tap,
  type Puzzle,
  type State,
} from './engine';

export interface SolveReport {
  /** true when every path left the board */
  cleared: boolean;
  /** path indices in the order they were unthreaded */
  order: number[];
  /** how many paths were free at each step, before that step's tap */
  freeCurve: number[];
  /** how many were still on the board at each step */
  liveCurve: number[];
  /**
   * The difficulty number: the smallest share of live paths that could go at
   * any one moment.
   *
   * It has to be a share rather than a count, and finding that out cost a
   * rewrite. A raw count bottoms out at 1 on every board ever built, because
   * the last path standing is always free — so it measured the endgame, which
   * is trivial on every board, instead of the middle, which is not.
   *
   * As a share it means something exact: it is the chance that a player picking
   * an arrowhead at random at the board's tightest moment picks one that can
   * actually go. One free path in twelve is 0.08 and is genuinely hard scanning.
   * Six in twelve is 0.5 and is a warm-up.
   */
  minFreeRatio: number;
  /**
   * Steps where exactly one path could go while three or more were still on the
   * board — the real "find the only one" moments. The three-path floor is what
   * excludes the endgame, where being down to one choice is arithmetic rather
   * than difficulty.
   */
  bottlenecks: number;
  /** paths still stuck on the board when nothing more could move */
  stranded: number;
}

/**
 * Unthread the board.
 *
 * Ties are broken by lowest index so the report is reproducible in CI. Any
 * other tie-break clears the same board — that is what confluence means — but a
 * difficulty number that changed between runs would be worthless.
 */
export function solve(p: Puzzle): SolveReport {
  let state: State = initialState(p);
  const order: number[] = [];
  const freeCurve: number[] = [];
  const liveCurve: number[] = [];

  for (;;) {
    if (isSolved(state)) break;
    const free = freePaths(p, state);
    if (free.length === 0) break;
    freeCurve.push(free.length);
    liveCurve.push(liveCount(state));
    const pick = free[0] as number;
    const move = tap(p, state, pick);
    if (!move || move.kind !== 'exit') break;
    state = move.state;
    order.push(pick);
  }

  let minFreeRatio = 1;
  let bottlenecks = 0;
  for (let i = 0; i < freeCurve.length; i++) {
    const free = freeCurve[i] as number;
    const live = liveCurve[i] as number;
    minFreeRatio = Math.min(minFreeRatio, free / live);
    if (free === 1 && live >= 3) bottlenecks++;
  }

  return {
    cleared: isSolved(state),
    order,
    freeCurve,
    liveCurve,
    minFreeRatio: freeCurve.length === 0 ? 0 : minFreeRatio,
    bottlenecks,
    stranded: liveCount(state),
  };
}

/**
 * Difficulty is the tightest moment, not the biggest board.
 *
 * A board where you can always see four ways out is easy however many paths it
 * has. A board that funnels down to one free head, more than once, is hard even
 * if it is small — because the work is scanning a dozen arrowheads to find the
 * only one with a clear run.
 */
export function rate(report: SolveReport): 1 | 2 | 3 {
  if (!report.cleared) return 3;
  if (report.minFreeRatio >= 0.4 && report.bottlenecks === 0) return 1;
  if (report.minFreeRatio >= 0.2 && report.bottlenecks <= 2) return 2;
  return 3;
}

export interface Hint {
  path: number;
  /** true when this is the only path that can leave right now */
  onlyOne: boolean;
  reason: string;
}

/**
 * The nudge. Points at a path that can leave, and says whether it is the only
 * one — which is the difference between "here is a move" and "here is THE move".
 *
 * Note what this never has to do: warn about stranding the board. Order does
 * not matter, so no tap can be a mistake you cannot come back from. The only
 * thing a player can lose here is a miss.
 */
export function nextFree(p: Puzzle, state: State): Hint | null {
  const free = freePaths(p, state);
  const pick = free[0];
  if (pick === undefined) return null;
  return {
    path: pick,
    onlyOne: free.length === 1,
    reason:
      free.length === 1
        ? 'This is the only path with a clear run from its arrowhead right now.'
        : 'This one has a clear run from its arrowhead — nothing is in its way.',
  };
}

/**
 * The next few, in the order they come apart, each applied before the next.
 *
 * This is the rung of the hint ladder that matters: it shows the board
 * unthreading rather than handing over one isolated fact, and it leaves the
 * player to actually make the taps.
 */
export function unthreadChain(p: Puzzle, state: State, max = 4): Hint[] {
  let work = state;
  const out: Hint[] = [];
  for (let i = 0; i < max; i++) {
    const step = nextFree(p, work);
    if (!step) break;
    out.push(step);
    const move = tap(p, work, step.path);
    if (!move || move.kind !== 'exit') break;
    work = move.state;
  }
  return out;
}

/**
 * Why a path cannot go — the first thing standing in its way.
 *
 * Used for the miss message, so it names a real obstacle instead of saying
 * "blocked". Returns the path index doing the blocking, or null if it is free.
 */
export function blockedBy(p: Puzzle, state: State, index: number): number | null {
  if (canGo(p, state, index)) return null;
  const path = p.paths[index];
  if (!path) return null;

  const occ = occupancy(p, state);
  const head = path.cells[path.cells.length - 1] as number;
  let x = head % p.w;
  let y = Math.floor(head / p.w);
  const dx = [0, 1, 0, -1][path.dir] as number;
  const dy = [-1, 0, 1, 0][path.dir] as number;

  for (;;) {
    x += dx;
    y += dy;
    if (x < 0 || x >= p.w || y < 0 || y >= p.h) return null;
    const at = occ[y * p.w + x] as number;
    if (at !== -1 && at !== index) return at;
  }
}
