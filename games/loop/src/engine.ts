/**
 * Loop (Slitherlink) — rules only. Pure TypeScript, no React, no DOM.
 *
 * This file must stay importable from a Node build script, because the
 * generator and the CI verifier both run it outside a browser.
 *
 * Rules: draw one closed loop along the grid lines. A number in a cell says
 * how many of that cell's four sides the loop uses. The loop never crosses
 * or branches, and there is only one of it.
 */

export interface Puzzle {
  /** stable id, e.g. "loop-2026-09-04" */
  id: string;
  game: 'loop';
  date: string;
  number: number;
  difficulty: 1 | 2 | 3;
  w: number;
  h: number;
  /** one per cell, row-major: 0..3 or -1 for no clue */
  clues: number[];
}

export const BLANK = 0;
export const LINE = 1;
export const CROSS = 2;
export type Mark = 0 | 1 | 2;

/** One mark per edge. This is the whole mutable game state. */
export type Marks = Mark[];

export interface Edge {
  id: number;
  /** the two dots it joins, as vertex ids */
  a: number;
  b: number;
  horizontal: boolean;
  /** dot coordinates of the first endpoint */
  x: number;
  y: number;
}

export interface Topology {
  edges: Edge[];
  /** edge ids around each cell: top, right, bottom, left */
  cellEdges: number[][];
  /** edge ids meeting at each dot */
  vertexEdges: number[][];
  /** cells on either side of an edge (one for a border edge) */
  edgeCells: number[][];
  /** cells with a clue */
  clued: number[];
}

/** Dots are (w+1)×(h+1); vertex id = y*(w+1)+x. */
export function vertexId(p: Puzzle, x: number, y: number): number {
  return y * (p.w + 1) + x;
}

export function buildTopology(p: Puzzle): Topology {
  const { w, h } = p;
  const edges: Edge[] = [];
  const hId = (x: number, y: number): number => y * w + x; // y in 0..h
  const vId = (x: number, y: number): number => (h + 1) * w + y * (w + 1) + x; // y in 0..h-1

  for (let y = 0; y <= h; y++) {
    for (let x = 0; x < w; x++) {
      edges.push({ id: hId(x, y), a: vertexId(p, x, y), b: vertexId(p, x + 1, y), horizontal: true, x, y });
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x <= w; x++) {
      edges.push({ id: vId(x, y), a: vertexId(p, x, y), b: vertexId(p, x, y + 1), horizontal: false, x, y });
    }
  }

  const cellEdges: number[][] = [];
  const edgeCells: number[][] = edges.map(() => []);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const around = [hId(x, y), vId(x + 1, y), hId(x, y + 1), vId(x, y)];
      cellEdges.push(around);
      for (const e of around) edgeCells[e]!.push(c);
    }
  }

  const vertexEdges: number[][] = Array.from({ length: (w + 1) * (h + 1) }, () => []);
  for (const e of edges) {
    vertexEdges[e.a]!.push(e.id);
    vertexEdges[e.b]!.push(e.id);
  }

  const clued: number[] = [];
  p.clues.forEach((n, c) => {
    if (n >= 0) clued.push(c);
  });

  return { edges, cellEdges, vertexEdges, edgeCells, clued };
}

export function emptyMarks(topo: Topology): Marks {
  return new Array<Mark>(topo.edges.length).fill(BLANK);
}

/** A tap goes blank -> line -> cross -> blank. The line comes first because it is the move. */
export function cycleEdge(marks: Marks, id: number): Marks {
  const next = marks.slice();
  const cur = marks[id] ?? BLANK;
  next[id] = cur === BLANK ? LINE : cur === LINE ? CROSS : BLANK;
  return next;
}

export function lineCount(marks: Marks, ids: number[]): number {
  let k = 0;
  for (const id of ids) if (marks[id] === LINE) k++;
  return k;
}

/**
 * How the drawn lines hang together: how many separate paths there are,
 * whether any has closed into a loop, and where the loose ends are.
 */
export interface Network {
  /** separate pieces of line */
  pieces: number;
  /** pieces that have closed on themselves */
  closed: number;
  /** dots where three or more lines meet */
  forks: number[];
  /** dots where a line stops */
  ends: number[];
  lines: number;
}

export function network(p: Puzzle, topo: Topology, marks: Marks): Network {
  const nv = (p.w + 1) * (p.h + 1);
  const parent = Array.from({ length: nv }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const degree = new Array<number>(nv).fill(0);
  let lines = 0;
  const closedRoots = new Set<number>();
  for (const e of topo.edges) {
    if (marks[e.id] !== LINE) continue;
    lines++;
    degree[e.a]!++;
    degree[e.b]!++;
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) closedRoots.add(ra);
    else parent[ra] = rb;
  }
  const roots = new Set<number>();
  const forks: number[] = [];
  const ends: number[] = [];
  for (let v = 0; v < nv; v++) {
    if (degree[v] === 0) continue;
    roots.add(find(v));
    if (degree[v]! >= 3) forks.push(v);
    if (degree[v] === 1) ends.push(v);
  }
  let closed = 0;
  for (const r of closedRoots) if (roots.has(find(r))) closed++;
  return { pieces: roots.size, closed, forks, ends, lines };
}

/** Clue cells that have too many lines. */
export function overfull(p: Puzzle, topo: Topology, marks: Marks): number[] {
  return topo.clued.filter((c) => lineCount(marks, topo.cellEdges[c]!) > p.clues[c]!);
}

/**
 * Edges the drawn lines already rule out: the remaining sides of a clue that
 * has its lines, and the other edges at a dot that already has two. The
 * board draws these as faint crosses.
 */
export function implied(p: Puzzle, topo: Topology, marks: Marks): boolean[] {
  const out = new Array<boolean>(marks.length).fill(false);
  for (const c of topo.clued) {
    const around = topo.cellEdges[c]!;
    if (lineCount(marks, around) < p.clues[c]!) continue;
    for (const e of around) if (marks[e] !== LINE) out[e] = true;
  }
  for (const around of topo.vertexEdges) {
    if (lineCount(marks, around) < 2) continue;
    for (const e of around) if (marks[e] !== LINE) out[e] = true;
  }
  return out;
}

export function isSolved(p: Puzzle, topo: Topology, marks: Marks): boolean {
  for (const c of topo.clued) {
    if (lineCount(marks, topo.cellEdges[c]!) !== p.clues[c]) return false;
  }
  const net = network(p, topo, marks);
  return net.lines > 0 && net.pieces === 1 && net.closed === 1 && net.forks.length === 0 && net.ends.length === 0;
}

export interface Progress {
  lines: number;
  cluesMet: number;
  cluesTotal: number;
  cluesOver: number;
  pieces: number;
  closed: number;
  forks: number;
}

/** Everything the read-out under the board needs, in one pass. */
export function progress(p: Puzzle, topo: Topology, marks: Marks): Progress {
  let met = 0;
  let over = 0;
  for (const c of topo.clued) {
    const k = lineCount(marks, topo.cellEdges[c]!);
    if (k === p.clues[c]) met++;
    if (k > p.clues[c]!) over++;
  }
  const net = network(p, topo, marks);
  return {
    lines: net.lines,
    cluesMet: met,
    cluesTotal: topo.clued.length,
    cluesOver: over,
    pieces: net.pieces,
    closed: net.closed,
    forks: net.forks.length,
  };
}
