/**
 * Bridges (Hashiwokakero) — rules only. Pure TypeScript, no React, no DOM.
 *
 * This file must stay importable from a Node build script, because the
 * generator and the CI verifier both run it outside a browser.
 *
 * Rules: join numbered islands with bridges. At most two between any pair,
 * bridges run only horizontally or vertically, never cross another bridge,
 * every island's number is its exact bridge count, and the finished network
 * must be a single connected whole.
 */

export interface IslandDef {
  x: number;
  y: number;
  /** required total number of bridges touching this island (1..8) */
  n: number;
}

export interface Puzzle {
  /** stable id, e.g. "bridges-2026-09-04" */
  id: string;
  game: 'bridges';
  date: string;
  number: number;
  difficulty: 1 | 2 | 3;
  w: number;
  h: number;
  islands: IslandDef[];
}

export interface Edge {
  id: number;
  a: number;
  b: number;
  horizontal: boolean;
}

export interface Topology {
  edges: Edge[];
  /** edge ids touching each island */
  incident: number[][];
  /** pairs of edge ids that would physically cross */
  crossings: [number, number][];
}

/** Bridge counts indexed by edge id. This is the whole mutable game state. */
export type Counts = number[];

/**
 * Candidate bridges: for each island, the next island directly right and
 * directly below with nothing in between. Every legal bridge is one of these.
 */
export function buildTopology(p: Puzzle): Topology {
  const at = new Map<string, number>();
  p.islands.forEach((is, i) => at.set(`${is.x},${is.y}`, i));

  const edges: Edge[] = [];
  const incident: number[][] = p.islands.map(() => []);

  const scan = (i: number, dx: number, dy: number): void => {
    const from = p.islands[i]!;
    let x = from.x + dx;
    let y = from.y + dy;
    while (x >= 0 && x < p.w && y >= 0 && y < p.h) {
      const j = at.get(`${x},${y}`);
      if (j !== undefined) {
        const edge: Edge = { id: edges.length, a: i, b: j, horizontal: dy === 0 };
        edges.push(edge);
        incident[i]!.push(edge.id);
        incident[j]!.push(edge.id);
        return;
      }
      x += dx;
      y += dy;
    }
  };

  for (let i = 0; i < p.islands.length; i++) {
    scan(i, 1, 0);
    scan(i, 0, 1);
  }

  const crossings: [number, number][] = [];
  for (const h of edges) {
    if (!h.horizontal) continue;
    const ha = p.islands[h.a]!;
    const hb = p.islands[h.b]!;
    const [hx1, hx2] = ha.x < hb.x ? [ha.x, hb.x] : [hb.x, ha.x];
    const hy = ha.y;
    for (const v of edges) {
      if (v.horizontal) continue;
      const va = p.islands[v.a]!;
      const vb = p.islands[v.b]!;
      const [vy1, vy2] = va.y < vb.y ? [va.y, vb.y] : [vb.y, va.y];
      const vx = va.x;
      if (vx > hx1 && vx < hx2 && hy > vy1 && hy < vy2) crossings.push([h.id, v.id]);
    }
  }

  return { edges, incident, crossings };
}

export function emptyCounts(topo: Topology): Counts {
  return new Array<number>(topo.edges.length).fill(0);
}

/** Degree of each island under the given counts. */
export function degrees(p: Puzzle, topo: Topology, counts: Counts): number[] {
  const deg = new Array<number>(p.islands.length).fill(0);
  for (const e of topo.edges) {
    const c = counts[e.id] ?? 0;
    deg[e.a]! += c;
    deg[e.b]! += c;
  }
  return deg;
}

/** Would setting this edge to `value` cross a bridge that already exists? */
export function blockedByCrossing(topo: Topology, counts: Counts, edgeId: number): boolean {
  for (const [a, b] of topo.crossings) {
    if (a === edgeId && (counts[b] ?? 0) > 0) return true;
    if (b === edgeId && (counts[a] ?? 0) > 0) return true;
  }
  return false;
}

/**
 * The single player-facing action: cycle a bridge 0 -> 1 -> 2 -> 0.
 * Returns null when the move is illegal, so the UI can shake rather than guess.
 */
export function cycleBridge(
  p: Puzzle,
  topo: Topology,
  counts: Counts,
  edgeId: number,
): Counts | null {
  const current = counts[edgeId] ?? 0;
  const nextValue = (current + 1) % 3;
  if (nextValue > 0 && blockedByCrossing(topo, counts, edgeId)) return null;

  const next = counts.slice();
  next[edgeId] = nextValue;

  if (nextValue > current) {
    const e = topo.edges[edgeId]!;
    const deg = degrees(p, topo, next);
    if (deg[e.a]! > p.islands[e.a]!.n || deg[e.b]! > p.islands[e.b]!.n) return null;
  }
  return next;
}

/** Are all islands reachable from island 0 using placed bridges? */
export function isConnected(p: Puzzle, topo: Topology, counts: Counts): boolean {
  const n = p.islands.length;
  if (n === 0) return true;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  let groups = n;
  for (const e of topo.edges) {
    if ((counts[e.id] ?? 0) === 0) continue;
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) {
      parent[ra] = rb;
      groups--;
    }
  }
  return groups === 1;
}

export function isSolved(p: Puzzle, topo: Topology, counts: Counts): boolean {
  const deg = degrees(p, topo, counts);
  for (let i = 0; i < p.islands.length; i++) {
    if (deg[i] !== p.islands[i]!.n) return false;
  }
  return isConnected(p, topo, counts);
}

/** Islands whose number is already satisfied — the UI dims these. */
export function satisfied(p: Puzzle, topo: Topology, counts: Counts): boolean[] {
  const deg = degrees(p, topo, counts);
  return p.islands.map((is, i) => deg[i] === is.n);
}
