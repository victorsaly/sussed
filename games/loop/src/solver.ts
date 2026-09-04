/**
 * The solver — the asset.
 *
 * Edge state is one byte: unknown, on, off. Propagation applies what a
 * person applies:
 *
 *   - a clue with its lines: the other sides are off
 *   - a clue with exactly as many free sides as it still needs: they are on
 *   - a dot never has one line: two, or none
 *   - a line may not close into a loop while any other line exists elsewhere,
 *     or while any clue is still short
 *
 * On top of that, the "what if" step a person does in their head: set an
 * unknown edge on, run the rules, and if that breaks something the edge is
 * off (and the other way round). Every classic corner and 3-3 pattern falls
 * out of that one step. Puzzles that need nothing deeper are the Monday and
 * Tuesday puzzles.
 */

import { buildTopology, CROSS, implied, LINE, type Marks, type Puzzle, type Topology } from './engine';

const U = 0;
const ON = 1;
const OFF = 2;

type State = Int8Array;

export interface SolveReport {
  /** capped at `limit` — 0 impossible, 1 unique, 2 ambiguous */
  count: number;
  solution?: Marks;
  /** how many times the solver had to guess beyond the what-if step */
  guesses: number;
  /** true when the techniques alone finished the puzzle */
  logicOnly: boolean;
}

/** What a hint points at: a numbered cell, a dot, or an edge. */
export interface HintFocus {
  kind: 'cell' | 'dot' | 'edge';
  index: number;
}

interface Note {
  reason: string;
  focus: HintFocus;
}

type Why = (Note | null)[] | null;

function set(s: State, e: number, v: number, why: Why, note: () => Note): boolean {
  const cur = s[e]!;
  if (cur === v) return true;
  if (cur !== U) return false;
  s[e] = v;
  if (why && why[e] === null) why[e] = note();
  return true;
}

/** Union-find over dots joined by on-edges; tells whether an edge would close a loop. */
function loops(p: Puzzle, topo: Topology, s: State): { find: (v: number) => number; onCount: number; compSize: Map<number, number> } {
  const nv = (p.w + 1) * (p.h + 1);
  const parent = Array.from({ length: nv }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  let onCount = 0;
  for (const e of topo.edges) {
    if (s[e.id] !== ON) continue;
    onCount++;
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent[ra] = rb;
  }
  const compSize = new Map<number, number>();
  for (const e of topo.edges) {
    if (s[e.id] !== ON) continue;
    const r = find(e.a);
    compSize.set(r, (compSize.get(r) ?? 0) + 1);
  }
  return { find, onCount, compSize };
}

function basic(p: Puzzle, topo: Topology, s: State, why: Why): boolean {
  let changed = true;
  while (changed) {
    changed = false;

    for (const c of topo.clued) {
      const need = p.clues[c]!;
      const around = topo.cellEdges[c]!;
      let on = 0;
      const free: number[] = [];
      for (const e of around) {
        if (s[e] === ON) on++;
        else if (s[e] === U) free.push(e);
      }
      if (on > need || on + free.length < need) return false;
      if (free.length === 0) continue;
      if (on === need) {
        for (const e of free) {
          if (!set(s, e, OFF, why, () => ({ reason: `This ${need} already has its ${need === 1 ? 'line' : 'lines'}, so its other sides stay empty.`, focus: { kind: 'cell', index: c } }))) return false;
          changed = true;
        }
      } else if (on + free.length === need) {
        for (const e of free) {
          if (!set(s, e, ON, why, () => ({ reason: `This ${need} has exactly ${free.length} free side${free.length === 1 ? '' : 's'} left for its last ${need - on}, so they must all be lines.`, focus: { kind: 'cell', index: c } }))) return false;
          changed = true;
        }
      }
    }

    for (let v = 0; v < topo.vertexEdges.length; v++) {
      const around = topo.vertexEdges[v]!;
      let on = 0;
      const free: number[] = [];
      for (const e of around) {
        if (s[e] === ON) on++;
        else if (s[e] === U) free.push(e);
      }
      if (on > 2) return false;
      if (on === 1 && free.length === 0) return false;
      if (free.length === 0) continue;
      if (on === 2) {
        for (const e of free) {
          if (!set(s, e, OFF, why, () => ({ reason: 'This dot already has its two lines, so nothing else can meet here.', focus: { kind: 'dot', index: v } }))) return false;
          changed = true;
        }
      } else if (on === 1 && free.length === 1) {
        if (!set(s, free[0]!, ON, why, () => ({ reason: 'A line cannot just stop. This is the only way on from that dot.', focus: { kind: 'dot', index: v } }))) return false;
        changed = true;
      } else if (on === 0 && free.length === 1) {
        if (!set(s, free[0]!, OFF, why, () => ({ reason: 'A line here would have nowhere to go from that dot.', focus: { kind: 'dot', index: v } }))) return false;
        changed = true;
      }
    }

    // Closing a loop early: allowed only if it would be the whole answer.
    const { find, onCount, compSize } = loops(p, topo, s);
    for (const e of topo.edges) {
      if (s[e.id] !== U) continue;
      const ra = find(e.a);
      if (ra !== find(e.b)) continue;
      const size = compSize.get(ra) ?? 0;
      // Would close this piece. Fine only if every line is in it and no clue is short.
      const rest = onCount - size;
      let short = false;
      if (rest === 0) {
        for (const c of topo.clued) {
          const around = topo.cellEdges[c]!;
          let on = 0;
          for (const f of around) if (s[f] === ON || f === e.id) on++;
          if (on < p.clues[c]!) {
            short = true;
            break;
          }
        }
      }
      if (rest > 0 || short) {
        if (!set(s, e.id, OFF, why, () => ({ reason: 'A line here would close the loop too early, leaving part of the puzzle outside it.', focus: { kind: 'edge', index: e.id } }))) return false;
        changed = true;
      }
    }
  }
  return true;
}

/** Basic rules plus the one-step what-if. */
function strong(p: Puzzle, topo: Topology, s: State, why: Why, once = false): boolean {
  if (!basic(p, topo, s, why)) return false;
  let changed = true;
  while (changed) {
    changed = false;
    for (let e = 0; e < s.length; e++) {
      if (s[e] !== U) continue;
      const tryOn = s.slice();
      tryOn[e] = ON;
      const onOk = basic(p, topo, tryOn, null);
      const tryOff = s.slice();
      tryOff[e] = OFF;
      const offOk = basic(p, topo, tryOff, null);
      if (!onOk && !offOk) return false;
      if (onOk === offOk) continue;
      const v = onOk ? ON : OFF;
      if (!set(s, e, v, why, () => ({ reason: v === ON ? 'Try leaving this empty: the lines around it get stuck. So it must be a line.' : 'Try a line here: the lines around it get stuck. So it stays empty.', focus: { kind: 'edge', index: e } }))) return false;
      if (!basic(p, topo, s, why)) return false;
      changed = true;
      if (once) return true;
    }
  }
  return true;
}

function isSingleLoop(p: Puzzle, topo: Topology, s: State): boolean {
  const { onCount, compSize } = loops(p, topo, s);
  if (onCount === 0 || compSize.size !== 1) return false;
  for (const around of topo.vertexEdges) {
    let on = 0;
    for (const e of around) if (s[e] === ON) on++;
    if (on !== 0 && on !== 2) return false;
  }
  return true;
}

/**
 * Count solutions, stopping at `limit`. Generation only ever needs to know
 * "is it exactly one?", so limit 2 is enough and keeps this fast.
 */
export function solve(p: Puzzle, limit = 2, topoIn?: Topology): SolveReport {
  const topo = topoIn ?? buildTopology(p);
  let count = 0;
  let guesses = 0;
  let solution: Marks | undefined;

  const root = new Int8Array(topo.edges.length);
  if (!strong(p, topo, root, null)) return { count: 0, guesses: 0, logicOnly: true };
  const logicOnly = root.every((v) => v !== U) && isSingleLoop(p, topo, root);

  const search = (s: State): void => {
    if (count >= limit) return;
    if (!strong(p, topo, s, null)) return;

    // Branch next to a loose end so each guess extends a path rather than
    // starting a new one — far fewer dead branches.
    let branch = -1;
    for (let v = 0; v < topo.vertexEdges.length && branch === -1; v++) {
      const around = topo.vertexEdges[v]!;
      let on = 0;
      let free = -1;
      for (const e of around) {
        if (s[e] === ON) on++;
        else if (s[e] === U && free === -1) free = e;
      }
      if (on === 1 && free !== -1) branch = free;
    }
    if (branch === -1) {
      for (const c of topo.clued) {
        for (const e of topo.cellEdges[c]!) {
          if (s[e] === U) {
            branch = e;
            break;
          }
        }
        if (branch !== -1) break;
      }
    }
    if (branch === -1) branch = s.indexOf(U);

    if (branch === -1) {
      if (isSingleLoop(p, topo, s)) {
        count++;
        if (!solution) solution = Array.from(s, (v) => (v === ON ? LINE : CROSS));
      }
      return;
    }

    guesses++;
    for (const v of [ON, OFF]) {
      const next = s.slice();
      next[branch] = v;
      search(next);
      if (count >= limit) return;
    }
  };

  search(root);
  return { count, solution, guesses, logicOnly: logicOnly && count === 1 };
}

/** Map solver effort onto the three difficulty bands the calendar uses. */
export function rate(report: SolveReport): 1 | 2 | 3 {
  if (report.logicOnly) return 1;
  if (report.guesses <= 12) return 2;
  return 3;
}

export interface Deduction {
  edge: number;
  value: 'line' | 'empty' | 'wrong';
  reason: string;
  /** the number, dot or edge that forces it — what a hint points at */
  focus: HintFocus;
}

function fromMarks(marks: Marks): State {
  const s = new Int8Array(marks.length);
  for (let i = 0; i < marks.length; i++) if (marks[i] === LINE) s[i] = ON;
  return s;
}

/**
 * A hint that teaches instead of telling: one edge the techniques can prove,
 * with the reason and the thing to look at. Only the player's lines are
 * trusted; crosses are notes.
 */
export function nextDeduction(p: Puzzle, topo: Topology, marks: Marks): Deduction | null {
  const shown = implied(p, topo, marks);

  const blame = (): Deduction => {
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] !== LINE) continue;
      const trial = marks.slice();
      trial[i] = 0;
      if (basic(p, topo, fromMarks(trial), null)) {
        return { edge: i, value: 'wrong', reason: 'This line cannot be right. Clear it and look again.', focus: { kind: 'edge', index: i } };
      }
    }
    const first = Math.max(0, marks.findIndex((m) => m === LINE));
    return { edge: -1, value: 'wrong', reason: 'The drawn lines cannot all be right. Undo a few and look again.', focus: { kind: 'edge', index: first } };
  };

  // First the plain rules on the visible board, then one what-if step, then
  // the full chain.
  const passes: ((s: State, why: Why) => boolean)[] = [
    (s, why) => basic(p, topo, s, why),
    (s, why) => strong(p, topo, s, why, true),
    (s, why) => strong(p, topo, s, why),
  ];
  for (const pass of passes) {
    const s = fromMarks(marks);
    const why: (Note | null)[] = new Array<Note | null>(s.length).fill(null);
    if (!pass(s, why)) return blame();
    const lines: number[] = [];
    const empties: number[] = [];
    for (let e = 0; e < s.length; e++) {
      if (s[e] === ON && marks[e] !== LINE) lines.push(e);
      if (s[e] === OFF && marks[e] !== CROSS && !shown[e]) empties.push(e);
    }
    const pick = lines[0] ?? empties[0];
    if (pick === undefined) continue;
    const note = why[pick];
    return {
      edge: pick,
      value: s[pick] === ON ? 'line' : 'empty',
      reason: note?.reason ?? (s[pick] === ON ? 'A line must go here.' : 'This edge stays empty.'),
      focus: note?.focus ?? { kind: 'edge', index: pick },
    };
  }
  return null;
}

/**
 * The next few forced moves, in the order a person would find them. Each is
 * applied to a scratch board before the next is looked for.
 */
export function deductionChain(p: Puzzle, topo: Topology, marks: Marks, max = 4): Deduction[] {
  const work = marks.slice();
  const out: Deduction[] = [];
  for (let k = 0; k < max; k++) {
    const step = nextDeduction(p, topo, work);
    if (!step || step.value === 'wrong') break;
    out.push(step);
    work[step.edge] = step.value === 'line' ? LINE : CROSS;
  }
  return out;
}

/** How to name a focus in a sentence. */
export function describeFocus(p: Puzzle, f: HintFocus): string {
  if (f.kind === 'cell') return `the ${p.clues[f.index]}`;
  if (f.kind === 'dot') return 'the dot that is pulsing';
  return 'the side that is pulsing';
}
