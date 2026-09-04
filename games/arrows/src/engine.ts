/**
 * Arrows Out — rules only. Pure TypeScript, no React, no DOM.
 *
 * A path is a run of cells with an arrowhead at one end. Tap it and the whole
 * path threads out of the board head first, following its own track. It can
 * only go if the straight run from its arrowhead to the edge is clear. Tap a
 * blocked path and nothing moves — that is a miss, and misses are the score.
 *
 * This mechanic replaced an earlier one, and the reason is worth recording
 * because it cost two solvers to find.
 *
 * The first design was one arrow per cell: tap it, it slides, it leaves. That
 * measured as no puzzle at all. A game whose only action REMOVES pieces is
 * confluent — taking a piece off the board never makes anything harder — so if
 * a solution exists you reach it by tapping whatever moves, in any order.
 * Across 400 boards, every solvable one fell to that, and par always equalled
 * the arrow count.
 *
 * The second design fought the confluence: tapping a blocked arrow turned it
 * 90°, so a wrong turn cost a tap. That worked, and it is in the git history.
 *
 * This third design accepts the confluence instead. Order still never matters
 * and greedy still always clears the board — but on a board eighty per cent
 * full, with a dozen interlocking paths, SEEING which arrowhead has a clear run
 * is the whole game. The difficulty moved from planning to perception, which is
 * the half that survives a stranger's first five seconds.
 *
 * The consequence has to be stated rather than hidden: Arrows cannot claim the
 * one-solution invariant the deduction games hold. Its guarantee is different —
 * every shipped board fully clears, and no sequence of taps can strand you —
 * and `tools/verify.ts` proves that board by board.
 */

export type Dir = 0 | 1 | 2 | 3; // N E S W

export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];
export const GLYPH = ['↑', '→', '↓', '←'] as const;

/**
 * One path, ordered tail first and head last.
 *
 * The arrowhead is `cells[cells.length - 1]` and is not stored separately. A
 * second field naming the head is a second thing that can disagree with the
 * first, and an arrowhead that disagrees with its path is exactly the bug that
 * made a prototype arrow point left and then leave upward.
 */
export interface PathDef {
  cells: number[];
  /** the way it leaves. The last body segment must run along this — see `headAligned`. */
  dir: Dir;
}

export interface Puzzle {
  id: string;
  game: 'arrows';
  /** ISO date for a daily; empty for a course level, as in the other games */
  date: string;
  number: number;
  difficulty: 1 | 2 | 3;
  w: number;
  h: number;
  paths: PathDef[];
}

/**
 * Which paths are still on the board. Direction is fixed for the life of a
 * puzzle now, so it lives in the puzzle and not in the state.
 */
export interface State {
  readonly live: readonly boolean[];
}

export const cell = (p: Puzzle, x: number, y: number): number => y * p.w + x;
export const cellX = (p: Puzzle, c: number): number => c % p.w;
export const cellY = (p: Puzzle, c: number): number => Math.floor(c / p.w);

/** The arrowhead. Always the last cell — see the note on PathDef. */
export const headCell = (path: PathDef): number => path.cells[path.cells.length - 1] as number;

export function initialState(p: Puzzle): State {
  return { live: p.paths.map(() => true) };
}

/** Path index per cell, or -1. Paths never overlap, so one pass is enough. */
export function occupancy(p: Puzzle, state: State): Int16Array {
  const grid = new Int16Array(p.w * p.h).fill(-1);
  for (let i = 0; i < p.paths.length; i++) {
    if (!state.live[i]) continue;
    for (const c of (p.paths[i] as PathDef).cells) grid[c] = i;
  }
  return grid;
}

/**
 * Can this path leave?
 *
 * Only the head needs room. The body costs nothing, because it follows exactly
 * where the head went — every cell the body crosses is one the head has already
 * vacated. That is why an eighty-per-cent-full board comes apart at all, and it
 * is the one rule a player has to internalise.
 */
export function canGo(p: Puzzle, state: State, index: number, grid?: Int16Array): boolean {
  const path = p.paths[index];
  if (!path || !state.live[index]) return false;

  const occ = grid ?? occupancy(p, state);
  const head = headCell(path);
  let x = cellX(p, head);
  let y = cellY(p, head);
  const dx = DX[path.dir] as number;
  const dy = DY[path.dir] as number;

  for (;;) {
    x += dx;
    y += dy;
    if (x < 0 || x >= p.w || y < 0 || y >= p.h) return true;
    const at = occ[y * p.w + x] as number;
    if (at !== -1 && at !== index) return false;
  }
}

/** Every path that could leave right now. The hint ladder and the solver share this. */
export function freePaths(p: Puzzle, state: State): number[] {
  const occ = occupancy(p, state);
  const out: number[] = [];
  for (let i = 0; i < p.paths.length; i++) {
    if (state.live[i] && canGo(p, state, i, occ)) out.push(i);
  }
  return out;
}

export type MoveKind = 'exit' | 'miss';

export interface MoveResult {
  state: State;
  kind: MoveKind;
}

/**
 * The one player action. A tap on a live path either threads it out or is a
 * miss — and a miss must be shown, not swallowed. A tap that silently does
 * nothing teaches nothing, and here the miss is the entire score.
 */
export function tap(p: Puzzle, state: State, index: number): MoveResult | null {
  if (!state.live[index]) return null;
  if (!canGo(p, state, index)) return { state, kind: 'miss' };
  const live = state.live.slice();
  live[index] = false;
  return { state: { live }, kind: 'exit' };
}

export const isSolved = (state: State): boolean => state.live.every((v) => !v);

export const cleared = (state: State): number =>
  state.live.reduce<number>((n, v) => n + (v ? 0 : 1), 0);

export const liveCount = (state: State): number =>
  state.live.reduce<number>((n, v) => n + (v ? 1 : 0), 0);

/** Stable key for memoisation. Only liveness varies now, so this is a bitstring. */
export const key = (state: State): string => state.live.map((v) => (v ? '1' : '0')).join('');

/** Share of the board covered by paths. This is what makes a board look impossible. */
export function density(p: Puzzle): number {
  const filled = p.paths.reduce((n, path) => n + path.cells.length, 0);
  return filled / (p.w * p.h);
}

/**
 * Does the arrowhead tell the truth?
 *
 * The last body segment must run along the exit direction, so the drawn head
 * points the way the path will actually leave. One arrowhead that lies costs
 * the player's trust in every arrowhead on the board, so the generator enforces
 * this and CI refuses any board where it does not hold.
 */
export function headAligned(p: Puzzle, path: PathDef): boolean {
  if (path.cells.length < 2) return true;
  const head = headCell(path);
  const before = path.cells[path.cells.length - 2] as number;
  return (
    cellX(p, head) - cellX(p, before) === DX[path.dir] &&
    cellY(p, head) - cellY(p, before) === DY[path.dir]
  );
}

/** Cells must be distinct, in bounds, and orthogonally adjacent in order. */
export function isContiguous(p: Puzzle, path: PathDef): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < path.cells.length; i++) {
    const c = path.cells[i] as number;
    if (c < 0 || c >= p.w * p.h || seen.has(c)) return false;
    seen.add(c);
    if (i === 0) continue;
    const prev = path.cells[i - 1] as number;
    const step = Math.abs(cellX(p, c) - cellX(p, prev)) + Math.abs(cellY(p, c) - cellY(p, prev));
    if (step !== 1) return false;
  }
  return path.cells.length > 0;
}
