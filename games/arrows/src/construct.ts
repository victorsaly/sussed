/**
 * Board construction. Pure TypeScript — no node, no DOM, no React — because it
 * runs in the CI generator and is also how the course boards were produced.
 *
 * The whole method is one idea, and it is what makes a dense board solvable at
 * all: lay each path only on cells whose exit ray is clear AT THE MOMENT OF
 * PLACEMENT.
 *
 * Then unthreading in reverse placement order always works. Remove the last
 * path first: its ray was clear of everything placed before it, and those are
 * the only paths still on the board. Remove the next: same argument, one path
 * smaller. All the way down. Later paths are free to sit across an earlier
 * path's exit ray, because they leave first.
 *
 * Random dense boards essentially never come apart. This is not a filter that
 * finds the rare good board — it is a construction that cannot produce a bad
 * one.
 */

import type { Rng } from '@sussed/core';
import { DX, DY, type Dir, type PathDef } from './engine';

export interface BoardSpec {
  w: number;
  h: number;
  /** stop once this share of cells is covered */
  density: number;
  minLen: number;
  maxLen: number;
  /**
   * Lay each new path across the exit rays of the paths already down, instead
   * of wherever it happens to fit.
   *
   * Without this, density alone does not make a board hard. As the board fills,
   * the only heads with a clear ray are the ones near an edge, so every
   * late-placed path is short, boundary-hugging, and free from the opening
   * position — and a board that shows you nine clear runs at a glance is a
   * warm-up however full it looks. Aiming the bodies at existing rays inverts
   * that: each path buries the ones beneath it, so the board opens with two or
   * three legal moves and has to be unpicked in something close to one order.
   */
  tighten?: boolean;
}

const TAKEN = 1;

/** Is the straight run from `cell` in `dir` free of already-placed cells? */
function rayClear(occ: Uint8Array, w: number, h: number, cellIndex: number, dir: Dir): boolean {
  let x = (cellIndex % w) + (DX[dir] as number);
  let y = Math.floor(cellIndex / w) + (DY[dir] as number);
  while (x >= 0 && x < w && y >= 0 && y < h) {
    if (occ[y * w + x] === TAKEN) return false;
    x += DX[dir] as number;
    y += DY[dir] as number;
  }
  return true;
}

function neighbours(w: number, h: number, cellIndex: number): number[] {
  const x = cellIndex % w;
  const y = Math.floor(cellIndex / w);
  const out: number[] = [];
  for (let d = 0; d < 4; d++) {
    const nx = x + (DX[d] as number);
    const ny = y + (DY[d] as number);
    if (nx >= 0 && nx < w && ny >= 0 && ny < h) out.push(ny * w + nx);
  }
  return out;
}

/**
 * One path, grown backwards from its arrowhead.
 *
 * The first step back is forced to be opposite the exit direction, which is
 * what makes the drawn arrowhead honest: the last body segment then runs along
 * the way the path will actually leave.
 */
function growPath(
  rng: Rng,
  spec: BoardSpec,
  occ: Uint8Array,
  rays: Uint8Array,
  head: number,
  dir: Dir,
  want: number,
): PathDef | null {
  const { w, h } = spec;
  const backX = (head % w) - (DX[dir] as number);
  const backY = Math.floor(head / w) - (DY[dir] as number);
  if (backX < 0 || backX >= w || backY < 0 || backY >= h) return null;

  const second = backY * w + backX;
  if (occ[second] === TAKEN) return null;

  // built head-first, reversed at the end
  const chain = [head, second];
  const used = new Set(chain);

  while (chain.length < want) {
    const tail = chain[chain.length - 1] as number;
    const open = rng
      .shuffle(neighbours(w, h, tail))
      .filter((c) => occ[c] !== TAKEN && !used.has(c));
    // Shuffled first, so sorting on ray count keeps random tie-breaks.
    if (spec.tighten) open.sort((a, b) => (rays[b] as number) - (rays[a] as number));
    const next = open[0];
    if (next === undefined) break;
    chain.push(next);
    used.add(next);
  }

  if (chain.length < spec.minLen) return null;
  return { cells: chain.reverse(), dir };
}

/** Mark every cell this path's exit ray passes through, so later paths can aim at it. */
function markRay(rays: Uint8Array, w: number, h: number, head: number, dir: Dir): void {
  let x = (head % w) + (DX[dir] as number);
  let y = Math.floor(head / w) + (DY[dir] as number);
  while (x >= 0 && x < w && y >= 0 && y < h) {
    const at = y * w + x;
    if ((rays[at] as number) < 255) rays[at] = (rays[at] as number) + 1;
    x += DX[dir] as number;
    y += DY[dir] as number;
  }
}

/** How far the clear run from this head reaches. Longer rays cross more of the board. */
function rayLength(occ: Uint8Array, w: number, h: number, head: number, dir: Dir): number {
  let x = (head % w) + (DX[dir] as number);
  let y = Math.floor(head / w) + (DY[dir] as number);
  let n = 0;
  while (x >= 0 && x < w && y >= 0 && y < h) {
    if (occ[y * w + x] === TAKEN) return -1;
    n++;
    x += DX[dir] as number;
    y += DY[dir] as number;
  }
  return n;
}

/**
 * Build a board. Returns as many paths as fit before the density target, which
 * is occasionally one short of it — a board that is 78% full instead of 80% is
 * still a board, and retrying for the last cell costs more than it buys.
 */
export function buildBoard(rng: Rng, spec: BoardSpec): PathDef[] {
  const { w, h } = spec;
  const occ = new Uint8Array(w * h);
  const rays = new Uint8Array(w * h);
  const paths: PathDef[] = [];
  const target = Math.floor(w * h * spec.density);
  let filled = 0;

  const cells: number[] = [];
  for (let i = 0; i < w * h; i++) cells.push(i);

  for (let attempt = 0; attempt < 4000 && filled < target; attempt++) {
    // Sample a few placements and keep the one whose exit run crosses most of
    // the board. A long ray is a long stretch a later path can be laid across.
    let head = -1;
    let dir: Dir = 0;
    let best = -1;
    for (let look = 0; look < (spec.tighten ? 8 : 1); look++) {
      const c = rng.pick(cells);
      if (occ[c] === TAKEN) continue;
      const d = rng.int(4) as Dir;
      const len = rayLength(occ, w, h, c, d);
      if (len > best) {
        best = len;
        head = c;
        dir = d;
      }
    }
    if (head === -1 || best < 0) continue;
    if (!rayClear(occ, w, h, head, dir)) continue;

    const want = rng.range(spec.minLen, spec.maxLen);
    const path = growPath(rng, spec, occ, rays, head, dir, want);
    if (!path) continue;

    for (const c of path.cells) occ[c] = TAKEN;
    markRay(rays, w, h, head, dir);
    filled += path.cells.length;
    paths.push(path);
  }

  return paths;
}
