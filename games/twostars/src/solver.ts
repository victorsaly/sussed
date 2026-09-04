/**
 * The solver — the asset.
 *
 * Two jobs, and the second is the one that matters:
 *   1. Prove a generated puzzle has exactly one solution.
 *   2. Rate how hard it was, by counting how much guessing was needed after
 *      the human techniques ran out.
 *
 * State is one byte per cell: unknown, empty or star. Propagation applies the
 * techniques a person uses, in the order a person learns them:
 *
 *   - a star empties the eight cells around it
 *   - a unit with its stars placed is otherwise empty
 *   - a unit with exactly as many free cells as it still needs fills them
 *   - in a row or column, the free cells fall into runs; if the runs can only
 *     just hold what is needed, the odd-length runs are forced
 *   - if a band of m adjacent rows (or columns) wholly contains m regions,
 *     those regions own every star in the band, and the rest of the band is
 *     empty
 *
 * Everything else is search.
 */

import { buildUnits, DOT, implied, STAR, type Cells, type Mark, type Puzzle, type Units } from './engine';

const U = 0; // unknown
const E = 1; // empty
const S = 2; // star

type State = Int8Array;

export interface SolveReport {
  /** capped at `limit` — 0 impossible, 1 unique, 2 ambiguous */
  count: number;
  solution?: Cells;
  /** every solution found, up to `limit` */
  solutions: Cells[];
  /** how many times the solver had to guess; the difficulty signal */
  guesses: number;
  /** true when propagation alone finished the puzzle */
  logicOnly: boolean;
}

/** What a hint points at: the thing that already decides something. */
export interface HintFocus {
  kind: 'row' | 'column' | 'region' | 'cell' | 'rows' | 'columns';
  index: number;
  /** for a band of rows or columns, how many */
  span?: number;
}

interface Note {
  reason: string;
  focus: HintFocus;
}

/** Optional trace: why each cell was set, for the hint. */
type Why = (Note | null)[] | null;

function set(s: State, i: number, v: number, why: Why, note: () => Note): boolean {
  const cur = s[i]!;
  if (cur === v) return true;
  if (cur !== U) return false;
  s[i] = v;
  if (why && why[i] === null) why[i] = note();
  return true;
}

const ord = (k: number): string => `${k}${['th', 'st', 'nd', 'rd'][k % 10 > 3 || (k % 100 >= 11 && k % 100 <= 13) ? 0 : k % 10]}`;

function unitName(kind: 'row' | 'column' | 'region', k: number): string {
  return kind === 'region' ? 'this region' : `the ${ord(k + 1)} ${kind}`;
}

function propagate(p: Puzzle, u: Units, s: State, why: Why, once = false): boolean {
  const k = p.stars;
  const n = p.n;
  let changed = true;

  const applyUnit = (kind: 'row' | 'column' | 'region', idx: number, unit: number[]): boolean => {
    let stars = 0;
    const free: number[] = [];
    for (const i of unit) {
      if (s[i] === S) stars++;
      else if (s[i] === U) free.push(i);
    }
    if (stars > k || stars + free.length < k) return false;
    if (stars === k) {
      for (const i of free) {
        if (!set(s, i, E, why, () => ({ reason: `${cap(unitName(kind, idx))} already has its ${k} stars, so this cell stays empty.`, focus: { kind, index: idx } }))) return false;
        changed = true;
      }
      return true;
    }
    if (stars + free.length === k) {
      for (const i of free) {
        if (!set(s, i, S, why, () => ({ reason: `${cap(unitName(kind, idx))} has only ${free.length} free cell${free.length === 1 ? '' : 's'} for its last ${k - stars} star${k - stars === 1 ? '' : 's'}, so this must be one.`, focus: { kind, index: idx } }))) return false;
        changed = true;
      }
      return true;
    }
    // Runs of free cells along a line: two stars cannot sit side by side, so a
    // run of length L holds at most ceil(L/2). If the runs can only just hold
    // what is needed, every odd-length run is fixed.
    if (kind !== 'region') {
      const runs: number[][] = [];
      let run: number[] = [];
      for (const i of unit) {
        if (s[i] === U) run.push(i);
        else {
          if (run.length) runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);
      let room = 0;
      for (const r of runs) room += Math.ceil(r.length / 2);
      const need = k - stars;
      if (room < need) return false;
      if (room === need) {
        for (const r of runs) {
          if (r.length % 2 === 0) continue;
          for (let j = 0; j < r.length; j++) {
            const v = j % 2 === 0 ? S : E;
            if (!set(s, r[j]!, v, why, () => ({ reason: `${cap(unitName(kind, idx))} has just enough room for its stars, and they cannot touch, so this cell is ${v === S ? 'a star' : 'empty'}.`, focus: { kind, index: idx } }))) return false;
            changed = true;
          }
        }
      }
    }
    return true;
  };

  while (changed) {
    changed = false;

    // Stars clear their neighbours.
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== S) continue;
      for (const j of u.around[i]!) {
        if (s[j] === S) return false;
        if (s[j] === U) {
          if (!set(s, j, E, why, () => ({ reason: 'A star sits next to this cell, and stars never touch, so it stays empty.', focus: { kind: 'cell', index: i } }))) return false;
          changed = true;
        }
      }
    }

    for (let y = 0; y < n; y++) if (!applyUnit('row', y, u.rows[y]!)) return false;
    for (let x = 0; x < n; x++) if (!applyUnit('column', x, u.cols[x]!)) return false;
    for (let r = 0; r < n; r++) if (!applyUnit('region', r, u.regions[r]!)) return false;

    if (changed && !once) continue;

    // Bands: m adjacent rows that wholly contain m regions. Those regions
    // account for every star in the band, so the band's other cells are empty.
    // Same for columns.
    for (const kind of ['row', 'column'] as const) {
      const lines = kind === 'row' ? u.rows : u.cols;
      for (let m = 1; m < n && !changed; m++) {
        for (let start = 0; start + m <= n && !changed; start++) {
          const band = new Set<number>();
          for (let l = start; l < start + m; l++) for (const i of lines[l]!) band.add(i);
          const inside: number[] = [];
          for (let r = 0; r < n; r++) {
            if (u.regions[r]!.every((i) => band.has(i))) inside.push(r);
          }
          if (inside.length > m) return false;
          if (inside.length !== m) continue;
          const own = new Set(inside);
          for (const i of band) {
            if (s[i] !== U || own.has(u.of[i]![2])) continue;
            const label = m === 1 ? unitName(kind, start) : `${kind}s ${start + 1} to ${start + m}`;
            if (!set(s, i, E, why, () => ({ reason: `${cap(label)} wholly contain${m === 1 ? 's' : ''} ${m} region${m === 1 ? '' : 's'}, which use up every star there, so this cell stays empty.`, focus: { kind: kind === 'row' ? 'rows' : 'columns', index: start, span: m } }))) return false;
            changed = true;
          }
        }
      }
    }
    if (once) break;
  }
  return true;
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

function fromCells(p: Puzzle, cells: Cells, trustDots: boolean): State {
  const s = new Int8Array(p.n * p.n);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === STAR) s[i] = S;
    else if (trustDots && cells[i] === DOT) s[i] = E;
  }
  return s;
}

/**
 * Count solutions, stopping at `limit`. Generation only ever needs to know
 * "is it exactly one?", so limit 2 is enough and keeps this fast.
 */
export function solve(p: Puzzle, limit = 2, unitsIn?: Units): SolveReport {
  const u = unitsIn ?? buildUnits(p);
  let count = 0;
  let guesses = 0;
  const solutions: Cells[] = [];

  const search = (s: State): void => {
    if (count >= limit) return;
    if (!propagate(p, u, s, null)) return;

    // Branch on the most constrained unit: fewest free cells per star still needed.
    let best: number[] | null = null;
    let bestScore = Infinity;
    const consider = (unit: number[]): void => {
      let stars = 0;
      const free: number[] = [];
      for (const i of unit) {
        if (s[i] === S) stars++;
        else if (s[i] === U) free.push(i);
      }
      const need = p.stars - stars;
      if (need <= 0) return;
      const score = free.length / need;
      if (score < bestScore) {
        bestScore = score;
        best = free;
      }
    };
    u.rows.forEach(consider);
    u.cols.forEach(consider);
    u.regions.forEach(consider);

    if (best === null) {
      const cells = Array.from(s, (v) => (v === S ? STAR : DOT) as Mark);
      count++;
      solutions.push(cells);
      return;
    }

    guesses++;
    const cell = (best as number[])[0]!;
    for (const v of [S, E]) {
      const next = s.slice();
      next[cell] = v;
      search(next);
      if (count >= limit) return;
    }
  };

  search(new Int8Array(p.n * p.n));
  return { count, solution: solutions[0], solutions, guesses, logicOnly: guesses === 0 };
}

/** Map solver effort onto the three difficulty bands the calendar uses. */
export function rate(report: SolveReport): 1 | 2 | 3 {
  if (report.logicOnly) return 1;
  if (report.guesses <= 8) return 2;
  return 3;
}

export interface Deduction {
  cell: number;
  /** what the cell must be; 'wrong' means a placed star cannot be right */
  value: 'star' | 'empty' | 'wrong';
  reason: string;
  /** the row, column, region or star that forces it — what a hint points at */
  focus: HintFocus;
}

/**
 * A hint that teaches instead of telling: one cell that the techniques can
 * prove, with the reason and the thing to look at. Only the player's stars
 * are trusted; their dots are notes and may be wrong. Returns `null` when
 * nothing is forced.
 */
export function nextDeduction(p: Puzzle, u: Units, cells: Cells): Deduction | null {
  const shown = implied(p, u, cells);

  // Read the board the way the player sees it: one sweep of the techniques
  // over the placed stars. Only if that finds nothing do we chain further.
  for (const once of [true, false]) {
    const s = fromCells(p, cells, false);
    const why: (Note | null)[] = new Array<Note | null>(s.length).fill(null);
    if (!propagate(p, u, s, why, once)) {
      // Find the star to blame: remove each in turn until things are consistent.
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== STAR) continue;
        const trial = cells.slice();
        trial[i] = 0;
        if (propagate(p, u, fromCells(p, trial, false), null)) {
          return { cell: i, value: 'wrong', reason: 'This star cannot be right. Clear it and look again.', focus: { kind: 'cell', index: i } };
        }
      }
      const first = cells.findIndex((m) => m === STAR);
      return { cell: -1, value: 'wrong', reason: 'The placed stars cannot all be right. Undo a few and look again.', focus: { kind: 'cell', index: Math.max(0, first) } };
    }

    // A forced star is the most useful thing to learn; then an empty cell the
    // board is not already showing as ruled out.
    const stars: number[] = [];
    const empties: number[] = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === S && cells[i] !== STAR) stars.push(i);
      if (s[i] === E && cells[i] !== DOT && !shown[i]) empties.push(i);
    }
    const pick = stars[0] ?? empties[0];
    if (pick === undefined) continue;
    const note = why[pick];
    return {
      cell: pick,
      value: s[pick] === S ? 'star' : 'empty',
      reason: note?.reason ?? (s[pick] === S ? 'A star must go here.' : 'This cell stays empty.'),
      focus: note?.focus ?? { kind: 'cell', index: pick },
    };
  }
  return null;
}

/**
 * The next few forced moves, in the order a person would find them. Each is
 * applied to a scratch board before the next is looked for, so this is a
 * genuine causal chain rather than a list of unrelated answers.
 */
export function deductionChain(p: Puzzle, u: Units, cells: Cells, max = 4): Deduction[] {
  const work = cells.slice();
  const out: Deduction[] = [];
  for (let k = 0; k < max; k++) {
    const step = nextDeduction(p, u, work);
    if (!step || step.value === 'wrong') break;
    out.push(step);
    work[step.cell] = step.value === 'star' ? STAR : DOT;
  }
  return out;
}

/** How to name a focus in a sentence: "the 3rd row", "this region", "that star". */
export function describeFocus(f: HintFocus): string {
  if (f.kind === 'cell') return 'the star there';
  if (f.kind === 'region') return 'the outlined region';
  if (f.kind === 'rows' || f.kind === 'columns') {
    const span = f.span ?? 1;
    const word = f.kind === 'rows' ? 'row' : 'column';
    return span === 1 ? unitName(word, f.index) : `${word}s ${f.index + 1} to ${f.index + span}`;
  }
  return unitName(f.kind, f.index);
}
