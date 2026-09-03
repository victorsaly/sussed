/**
 * The solver — the asset.
 *
 * Two jobs, and the second is the one that matters:
 *   1. Prove a generated puzzle has exactly one solution. A puzzle with two
 *      answers is a bug the player experiences as unfairness.
 *   2. Rate how hard it was, by counting how much *guessing* was needed after
 *      constraint propagation ran out. A puzzle solvable by pure deduction is
 *      easy no matter how big it is; one that needs three nested guesses is
 *      hard no matter how small.
 *
 * Propagation works on bounds. Each edge has a possible range [lo, hi] within
 * 0..2. For an island needing n bridges, with minSum and maxSum over its
 * incident edges, each incident edge e is squeezed:
 *
 *     e.lo >= n - (maxSum - e.hi)      "the others cannot cover it all"
 *     e.hi <= n - (minSum - e.lo)      "the others already claim this much"
 *
 * That single rule, iterated to a fixed point, is most of human Hashi
 * technique. Crossings then kill any edge that would cut a placed bridge.
 */

import {
  buildTopology,
  isConnected,
  type Counts,
  type Puzzle,
  type Topology,
} from './engine';

interface Bounds {
  lo: Int8Array;
  hi: Int8Array;
}

export interface SolveReport {
  /** capped at `limit` — 0 impossible, 1 unique, 2 ambiguous */
  count: number;
  solution?: Counts;
  /** how many times the solver had to guess; the difficulty signal */
  guesses: number;
  /** true when propagation alone finished the puzzle */
  logicOnly: boolean;
}

function cloneBounds(b: Bounds): Bounds {
  return { lo: b.lo.slice(), hi: b.hi.slice() };
}

/** Iterate the island and crossing rules to a fixed point. False = contradiction. */
function propagate(p: Puzzle, topo: Topology, b: Bounds): boolean {
  let changed = true;
  while (changed) {
    changed = false;

    for (let i = 0; i < p.islands.length; i++) {
      const need = p.islands[i]!.n;
      const inc = topo.incident[i]!;
      let minSum = 0;
      let maxSum = 0;
      for (const id of inc) {
        minSum += b.lo[id]!;
        maxSum += b.hi[id]!;
      }
      if (need < minSum || need > maxSum) return false;

      for (const id of inc) {
        const othersMax = maxSum - b.hi[id]!;
        const othersMin = minSum - b.lo[id]!;
        const newLo = Math.max(b.lo[id]!, need - othersMax);
        const newHi = Math.min(b.hi[id]!, need - othersMin);
        if (newLo > newHi) return false;
        if (newLo !== b.lo[id]) {
          b.lo[id] = newLo;
          changed = true;
        }
        if (newHi !== b.hi[id]) {
          b.hi[id] = newHi;
          changed = true;
        }
      }
    }

    for (const [x, y] of topo.crossings) {
      if (b.lo[x]! > 0 && b.lo[y]! > 0) return false;
      if (b.lo[x]! > 0 && b.hi[y]! > 0) {
        b.hi[y] = 0;
        changed = true;
      }
      if (b.lo[y]! > 0 && b.hi[x]! > 0) {
        b.hi[x] = 0;
        changed = true;
      }
    }
  }
  return true;
}

/**
 * Count solutions, stopping at `limit`. Generation only ever needs to know
 * "is it exactly one?", so limit 2 is enough and keeps this fast.
 */
export function solve(p: Puzzle, limit = 2, topoIn?: Topology): SolveReport {
  const topo = topoIn ?? buildTopology(p);
  const n = topo.edges.length;

  const root: Bounds = { lo: new Int8Array(n), hi: new Int8Array(n).fill(2) };

  let count = 0;
  let guesses = 0;
  let firstGuessDepth = Infinity;
  let solution: Counts | undefined;

  const search = (b: Bounds, depth: number): void => {
    if (count >= limit) return;
    if (!propagate(p, topo, b)) return;

    let branch = -1;
    for (let i = 0; i < n; i++) {
      if (b.lo[i] !== b.hi[i]) {
        branch = i;
        break;
      }
    }

    if (branch === -1) {
      const counts = Array.from(b.lo);
      if (isConnected(p, topo, counts)) {
        count++;
        if (!solution) solution = counts;
      }
      return;
    }

    guesses++;
    firstGuessDepth = Math.min(firstGuessDepth, depth);
    for (let v = b.hi[branch]!; v >= b.lo[branch]!; v--) {
      const next = cloneBounds(b);
      next.lo[branch] = v;
      next.hi[branch] = v;
      search(next, depth + 1);
      if (count >= limit) return;
    }
  };

  search(root, 0);
  return { count, solution, guesses, logicOnly: guesses === 0 };
}

/** Map solver effort onto the three difficulty bands the calendar uses. */
export function rate(report: SolveReport): 1 | 2 | 3 {
  if (report.logicOnly) return 1;
  if (report.guesses <= 6) return 2;
  return 3;
}

/**
 * A hint that teaches instead of telling: find one edge that propagation can
 * prove, and hand back the reason. Never reveals the whole answer.
 */
export function nextDeduction(
  p: Puzzle,
  topo: Topology,
  counts: Counts,
): { edgeId: number; value: number; reason: string } | null {
  const n = topo.edges.length;
  const b: Bounds = { lo: new Int8Array(n), hi: new Int8Array(n).fill(2) };
  for (let i = 0; i < n; i++) {
    const c = counts[i] ?? 0;
    if (c > 0) b.lo[i] = c;
  }
  if (!propagate(p, topo, b)) return null;

  for (let i = 0; i < n; i++) {
    if (b.lo[i] === b.hi[i] && b.lo[i] !== (counts[i] ?? 0)) {
      const value = b.lo[i]!;
      const e = topo.edges[i]!;
      const island = p.islands[e.a]!;
      const reason =
        value === 0
          ? `The ${island.n} island can already be satisfied without this bridge.`
          : `The ${island.n} island cannot reach ${island.n} unless ${value === 2 ? 'both bridges go' : 'a bridge goes'} here.`;
      return { edgeId: i, value, reason };
    }
  }
  return null;
}
