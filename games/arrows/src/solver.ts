/**
 * The Arrows solver.
 *
 * Breadth-first, not depth-first. Rotation makes the state space cyclic — turn
 * an arrow four times and you are back where you started — so the acyclic
 * shortcut that works for Bridges does not apply here. BFS with a visited set
 * gives an exact minimum, which matters: par has to be right or the score is a
 * lie.
 *
 * A node budget bounds the worst case. A board that blows it is not "too hard",
 * it is unrated, and the generator throws it away rather than shipping a par it
 * cannot vouch for.
 */

import {
  initialState,
  isSolved,
  key,
  parFloor,
  tap,
  type Puzzle,
  type State,
} from './engine';

export const DEFAULT_BUDGET = 300_000;

export interface SolveReport {
  /** exact fewest taps, or Infinity if the search proved it impossible */
  par: number;
  /** taps above the floor — the rotations, i.e. the actual puzzle */
  excess: number;
  /** distinct positions visited */
  explored: number;
  /** true when the budget ran out before an answer was proved */
  unrated: boolean;
}

export function solve(p: Puzzle, budget = DEFAULT_BUDGET): SolveReport {
  const start = initialState(p);
  if (isSolved(start)) return { par: 0, excess: 0, explored: 0, unrated: false };

  const seen = new Set<string>([key(start)]);
  let frontier: State[] = [start];
  let depth = 0;

  while (frontier.length > 0) {
    depth++;
    const next: State[] = [];
    for (const state of frontier) {
      for (let i = 0; i < state.pos.length; i++) {
        const move = tap(p, state, i);
        if (!move) continue;
        if (isSolved(move.state)) {
          return { par: depth, excess: depth - parFloor(p), explored: seen.size, unrated: false };
        }
        const k = key(move.state);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > budget) {
          return { par: Infinity, excess: Infinity, explored: seen.size, unrated: true };
        }
        next.push(move.state);
      }
    }
    frontier = next;
  }

  return { par: Infinity, excess: Infinity, explored: seen.size, unrated: false };
}

/**
 * Difficulty is how many rotations par demands, not how big the board is.
 *
 * A board that clears in exactly one tap per arrow had nothing in the way of
 * anything and is a warm-up. Every tap above that floor is an arrow the player
 * had to notice was stuck, and turn, in the right direction, at the right time.
 */
export function rate(report: SolveReport): 1 | 2 | 3 {
  if (report.unrated || report.par === Infinity) return 3;
  if (report.excess === 0) return 1;
  if (report.excess <= 2) return 2;
  return 3;
}

export interface Hint {
  tile: number;
  /** what the tap will do, so a hint can say it in words */
  kind: 'slide' | 'exit' | 'turn';
  /** true when every other tap makes the solve longer */
  onlyBest: boolean;
  reason: string;
}

/**
 * The hint. Finds a tap that keeps the player on the shortest remaining solve,
 * and says whether it is the only such tap.
 *
 * Note what this does NOT need to do: warn about stranding the board. Rotation
 * means nothing is ever unrecoverable, so a hint here is always about the count,
 * never about rescue. That is a gentler game to be stuck in.
 */
export function nextBest(p: Puzzle, state: State, budget = 120_000): Hint | null {
  if (isSolved(state)) return null;

  const from = solveFrom(p, state, budget);
  if (from === Infinity) return null;

  const best: { tile: number; kind: 'slide' | 'exit' | 'turn' }[] = [];
  for (let i = 0; i < state.pos.length; i++) {
    const move = tap(p, state, i);
    if (!move) continue;
    const after = isSolved(move.state) ? 0 : solveFrom(p, move.state, budget);
    if (after + 1 === from) best.push({ tile: i, kind: move.kind });
  }
  if (best.length === 0) return null;

  // Prefer showing an exit: it is the most legible thing to point at.
  const pick = best.find((b) => b.kind === 'exit') ?? best[0]!;
  const onlyBest = best.length === 1;

  const reason =
    pick.kind === 'exit'
      ? onlyBest
        ? 'This one can leave now, and nothing else keeps you on par.'
        : 'This one can leave now — its way out is clear.'
      : pick.kind === 'turn'
        ? 'This one is stuck. Turning it now costs a tap but saves more later.'
        : 'Slide this one out of the way first.';

  return { tile: pick.tile, kind: pick.kind, onlyBest, reason };
}

/** Minimum taps from an arbitrary position. Same BFS, different start. */
function solveFrom(p: Puzzle, state: State, budget: number): number {
  if (isSolved(state)) return 0;
  const seen = new Set<string>([key(state)]);
  let frontier: State[] = [state];
  let depth = 0;

  while (frontier.length > 0) {
    depth++;
    const next: State[] = [];
    for (const s of frontier) {
      for (let i = 0; i < s.pos.length; i++) {
        const move = tap(p, s, i);
        if (!move) continue;
        if (isSolved(move.state)) return depth;
        const k = key(move.state);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > budget) return Infinity;
        next.push(move.state);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/** The next few best taps in order, for the third rung of the hint ladder. */
export function hintChain(p: Puzzle, state: State, max = 4): Hint[] {
  let work = state;
  const out: Hint[] = [];
  for (let i = 0; i < max; i++) {
    const step = nextBest(p, work);
    if (!step) break;
    out.push(step);
    const move = tap(p, work, step.tile);
    if (!move) break;
    work = move.state;
  }
  return out;
}
