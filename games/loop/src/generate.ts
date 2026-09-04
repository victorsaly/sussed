/**
 * The generator. Runs in CI, never in a browser.
 *
 * Strategy: grow a random blob of cells, take its outline as the loop, write
 * every cell's count, then remove clues one by one while the solver still
 * finds exactly one answer. That guarantees a solution by construction; the
 * solver has to confirm there is exactly one.
 *
 *   pnpm --filter @sussed/loop generate -- --days 400
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRng,
  dailySeed,
  difficultyForDate,
  addDays,
  toIsoDate,
  puzzleNumber,
  type Rng,
} from '@sussed/core';
import { buildTopology, LINE, type Puzzle } from './engine';
import { solve } from './solver';

export const EPOCH = '2026-01-01';
export const MAX_WEEKEND_GUESSES = 24;

const SIZES: Record<1 | 2 | 3, { w: number; h: number }> = {
  1: { w: 6, h: 6 },
  2: { w: 8, h: 8 },
  3: { w: 10, h: 10 },
};

/**
 * A random blob whose outline is one clean loop: connected, no holes, and no
 * two cells touching only at a corner (that would put four lines on a dot).
 */
export function growBlob(rng: Rng, w: number, h: number): boolean[] | null {
  const inside = new Array<boolean>(w * h).fill(false);
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x]!;

  const pinches = (x: number, y: number): boolean => {
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      if (at(x + dx, y + dy) && !at(x + dx, y) && !at(x, y + dy)) return true;
    }
    return false;
  };

  const target = Math.round(w * h * (0.4 + rng.next() * 0.2));
  const sx = rng.range(1, w - 2);
  const sy = rng.range(1, h - 2);
  inside[sy * w + sx] = true;
  let size = 1;
  const frontier = new Set<number>();
  const pushFrontier = (x: number, y: number): void => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!inside[ny * w + nx]) frontier.add(ny * w + nx);
    }
  };
  pushFrontier(sx, sy);

  let guard = 0;
  while (size < target && frontier.size > 0 && guard++ < w * h * 20) {
    const c = rng.pick([...frontier]);
    frontier.delete(c);
    const x = c % w;
    const y = Math.floor(c / w);
    if (pinches(x, y)) continue;
    inside[c] = true;
    size++;
    pushFrontier(x, y);
  }

  // Fill holes: anything not reachable from the border stays inside the loop.
  const seen = new Array<boolean>(w * h).fill(false);
  const queue: number[] = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!inside[y * w + x]) queue.push(y * w + x);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!inside[y * w + x]) queue.push(y * w + x);
  for (const c of queue) seen[c] = true;
  while (queue.length) {
    const c = queue.pop()!;
    const x = c % w;
    const y = Math.floor(c / w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (inside[j] || seen[j]) continue;
      seen[j] = true;
      queue.push(j);
    }
  }
  for (let c = 0; c < w * h; c++) if (!inside[c] && !seen[c]) inside[c] = true;

  // Filling holes cannot create pinches, but check the whole thing anyway.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside[y * w + x] && pinches(x, y)) return null;
  if (size < w * h * 0.3) return null;
  return inside;
}

export function generatePuzzle(
  seed: string,
  date: string,
  number: number,
  wanted: 1 | 2 | 3,
): Puzzle | null {
  const rng = createRng(seed);
  const { w, h } = SIZES[wanted];

  for (let attempt = 0; attempt < 40; attempt++) {
    const blob = growBlob(rng, w, h);
    if (!blob) continue;

    const puzzle: Puzzle = {
      id: `loop-${date}`,
      game: 'loop',
      date,
      number,
      difficulty: wanted,
      w,
      h,
      clues: new Array<number>(w * h).fill(-1),
    };
    const topo = buildTopology(puzzle);

    // The loop is the blob's outline; every cell starts with its true count.
    const on = topo.edges.map((e) => {
      const cells = topo.edgeCells[e.id]!;
      const ins = cells.filter((c) => blob[c]).length;
      return ins === 1;
    });
    for (let c = 0; c < w * h; c++) {
      puzzle.clues[c] = topo.cellEdges[c]!.filter((e) => on[e]).length;
    }

    // Monday to Thursday: the techniques must finish it. Weekends may need a
    // few real guesses, but only a few — a puzzle that needs dozens is not
    // hard, it is a coin toss. Remove clues while that holds and the answer
    // stays unique.
    const mustBeLogic = wanted < 3;
    const maxGuesses = mustBeLogic ? 0 : MAX_WEEKEND_GUESSES;
    const order = rng.shuffle([...Array(w * h).keys()]);
    /* buildTopology() is called fresh on every iteration, and reusing the
       `topo` above instead looks obviously right — the edge graph depends only
       on w and h, and neither changes here. It is wrong, and quietly so: a
       Topology also carries `clued`, the list of cells that currently have a
       clue. Hand the solver a stale one and it keeps counting clues that have
       just been removed, so every removal looks safe, the board empties, and
       the final solve on an under-constrained grid runs for minutes.

       Refreshing only `clued` is correct — it was tried, and produced a
       byte-identical bundle — but it is not worth the code: it saved no
       measurable time, because the solver dominates this loop completely and
       the topology rebuild is noise beside it. */
    for (const c of order) {
      const keep = puzzle.clues[c]!;
      puzzle.clues[c] = -1;
      const report = solve(puzzle, 2, buildTopology(puzzle));
      if (report.count !== 1 || report.guesses > maxGuesses) puzzle.clues[c] = keep;
    }

    const final = solve(puzzle, 2, buildTopology(puzzle));
    if (final.count !== 1) continue;
    if (final.guesses > maxGuesses) continue;
    if (!final.solution || final.solution.some((m, e) => (m === LINE) !== on[e]!)) continue;
    return puzzle;
  }
  return null;
}

export function generateRange(startDate: string, days: number): Puzzle[] {
  const out: Puzzle[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const difficulty = difficultyForDate(date);
    const number = puzzleNumber(EPOCH, date);
    let puzzle: Puzzle | null = null;
    for (let salt = 0; salt < 12 && !puzzle; salt++) {
      puzzle = generatePuzzle(`${dailySeed('loop', date)}#${salt}`, date, number, difficulty);
    }
    if (!puzzle) throw new Error(`Could not generate a unique puzzle for ${date}`);
    out.push(puzzle);
  }
  return out;
}

function main(): void {
  const args = process.argv.slice(2);
  const daysArg = args.indexOf('--days');
  const days = daysArg === -1 ? 400 : Number(args[daysArg + 1] ?? 400);
  const startArg = args.indexOf('--start');
  const start = startArg === -1 ? toIsoDate() : (args[startArg + 1] as string);

  const t0 = Date.now();
  const puzzles = generateRange(start, days);
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(here, '../public/puzzles.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ epoch: EPOCH, start, puzzles }));

  const byDiff = puzzles.reduce<Record<number, number>>((acc, p) => {
    acc[p.difficulty] = (acc[p.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`loop: ${puzzles.length} puzzles from ${start} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  easy ${byDiff[1] ?? 0} · medium ${byDiff[2] ?? 0} · hard ${byDiff[3] ?? 0}`);
  console.log(`  -> ${out}`);
}

// Run as a script (pnpm generate), importable as a module (tests, tools).
if (process.argv[1]?.includes('generate')) main();
