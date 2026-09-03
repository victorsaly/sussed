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
  type Marks,
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

export interface Deduction {
  edgeId: number;
  value: number;
  /** the island that forces it — what a hint should point at */
  island: number;
  reason: string;
}

/**
 * A hint that teaches instead of telling.
 *
 * Two details make the difference. It reads the player's own ✗ marks, so it
 * reasons from where they actually are rather than starting fresh. And it
 * returns WHICH island forces the move, so the first rung of the hint ladder
 * can point at a place to look without giving the answer away.
 */
export function nextDeduction(
  p: Puzzle,
  topo: Topology,
  counts: Counts,
  marks: Marks = new Set<number>(),
): Deduction | null {
  const n = topo.edges.length;
  const b: Bounds = { lo: new Int8Array(n), hi: new Int8Array(n).fill(2) };
  for (let i = 0; i < n; i++) {
    const c = counts[i] ?? 0;
    if (c > 0) b.lo[i] = c;
    if (marks.has(i)) b.hi[i] = 0;
  }
  if (!propagate(p, topo, b)) return null;

  for (let i = 0; i < n; i++) {
    if (b.lo[i] !== b.hi[i]) continue;
    const value = b.lo[i]!;
    const already = counts[i] ?? 0;
    // Nothing to say about a bridge the player has already placed correctly,
    // or one they have already ruled out themselves.
    if (value > 0 && value === already) continue;
    if (value === 0 && marks.has(i)) continue;
    const e = topo.edges[i]!;
    // Which endpoint actually forces it? That is the one worth staring at.
    let who = e.a;
    for (const cand of [e.a, e.b]) {
      const need = p.islands[cand]!.n;
      let mn = 0;
      let mx = 0;
      for (const id of topo.incident[cand]!) {
        mn += b.lo[id]!;
        mx += b.hi[id]!;
      }
      if (need === mx || need === mn) {
        who = cand;
        break;
      }
    }
    const n0 = p.islands[who]!.n;
    return {
      edgeId: i,
      value,
      island: who,
      reason:
        value === 0
          ? `The ${n0} is already spoken for — this one can be ruled out.`
          : `The ${n0} cannot reach ${n0} unless ${value === 2 ? 'both bridges go' : 'a bridge goes'} here.`,
    };
  }
  return null;
}

/**
 * The next few forced moves, in the order a person would find them.
 *
 * Each deduction is applied to a scratch board before the next is looked for,
 * so this is a genuine causal chain rather than a list of unrelated answers.
 * That ordering is the whole value — it shows the reasoning moving across the
 * board, which is the thing a single isolated hint can never convey.
 */
export function deductionChain(
  p: Puzzle,
  topo: Topology,
  counts: Counts,
  marks: Marks,
  max = 4,
): Deduction[] {
  const workCounts = counts.slice();
  const workMarks = new Set(marks);
  const out: Deduction[] = [];

  for (let k = 0; k < max; k++) {
    const step = nextDeduction(p, topo, workCounts, workMarks);
    if (!step) break;
    out.push(step);
    if (step.value === 0) workMarks.add(step.edgeId);
    else workCounts[step.edgeId] = step.value;
  }
  return out;
}
