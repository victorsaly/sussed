/**
 * The generator. Runs in CI, never in a browser.
 *
 * Strategy: build a valid solution first, then throw it away and keep only the
 * island counts. That guarantees at least one solution exists by construction;
 * the solver then has to confirm there is exactly one.
 *
 *   pnpm --filter @sussed/bridges generate -- --days 400
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
import { buildTopology, type Puzzle } from './engine';
import { solve } from './solver';

export const EPOCH = '2026-01-01';

const SIZES: Record<1 | 2 | 3, { w: number; h: number; islands: number }> = {
  1: { w: 7, h: 7, islands: 10 },
  2: { w: 9, h: 9, islands: 16 },
  3: { w: 13, h: 13, islands: 20 },
};

interface Draft {
  islands: { x: number; y: number }[];
  bridges: { a: number; b: number; count: number }[];
}

const key = (x: number, y: number): string => `${x},${y}`;

/** Does segment (x1,y1)-(x2,y2) cross any bridge already drawn? */
function crossesExisting(d: Draft, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const horiz = a.y === b.y;
  const [lo, hi] = horiz ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const fixed = horiz ? a.y : a.x;

  for (const br of d.bridges) {
    const p = d.islands[br.a]!;
    const q = d.islands[br.b]!;
    const bh = p.y === q.y;
    if (bh === horiz) continue;
    const [blo, bhi] = bh ? [Math.min(p.x, q.x), Math.max(p.x, q.x)] : [Math.min(p.y, q.y), Math.max(p.y, q.y)];
    const bfixed = bh ? p.y : p.x;
    if (bfixed > lo && bfixed < hi && fixed > blo && fixed < bhi) return true;
  }
  return false;
}

function degreeOf(d: Draft, i: number): number {
  let n = 0;
  for (const b of d.bridges) {
    if (b.a === i) n += b.count;
    if (b.b === i) n += b.count;
  }
  return n;
}

/** Grow a connected network of islands by random walks from existing ones. */
function growDraft(rng: Rng, w: number, h: number, target: number): Draft | null {
  const d: Draft = { islands: [{ x: rng.range(1, w - 2), y: rng.range(1, h - 2) }], bridges: [] };
  const occupied = new Set<string>([key(d.islands[0]!.x, d.islands[0]!.y)]);

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  let attempts = 0;
  while (d.islands.length < target && attempts < target * 60) {
    attempts++;
    const fromIdx = rng.int(d.islands.length);
    const from = d.islands[fromIdx]!;
    if (degreeOf(d, fromIdx) >= 6) continue;

    const [dx, dy] = rng.pick(dirs);
    const dist = rng.range(2, 4);
    const tx = from.x + dx * dist;
    const ty = from.y + dy * dist;
    if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
    if (occupied.has(key(tx, ty))) continue;

    // The straight line between them must be clear of other islands.
    let clear = true;
    for (let s = 1; s < dist; s++) {
      if (occupied.has(key(from.x + dx * s, from.y + dy * s))) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    if (crossesExisting(d, from, { x: tx, y: ty })) continue;

    d.islands.push({ x: tx, y: ty });
    occupied.add(key(tx, ty));
    d.bridges.push({ a: fromIdx, b: d.islands.length - 1, count: rng.chance(0.35) ? 2 : 1 });
  }

  if (d.islands.length < Math.floor(target * 0.75)) return null;

  // Extra links between islands that already face each other: this is what
  // makes the puzzle interesting rather than a tree with one obvious answer.
  const extras = Math.floor(d.islands.length * 0.6);
  for (let k = 0; k < extras * 4 && d.bridges.length < d.islands.length + extras; k++) {
    const i = rng.int(d.islands.length);
    const a = d.islands[i]!;
    const [dx, dy] = rng.pick(dirs);
    let step = 1;
    let j = -1;
    while (step < Math.max(w, h)) {
      const nx = a.x + dx * step;
      const ny = a.y + dy * step;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) break;
      const found = d.islands.findIndex((is) => is.x === nx && is.y === ny);
      if (found !== -1) {
        j = found;
        break;
      }
      step++;
    }
    if (j === -1 || j === i) continue;
    if (d.bridges.some((b) => (b.a === i && b.b === j) || (b.a === j && b.b === i))) continue;
    if (degreeOf(d, i) >= 7 || degreeOf(d, j) >= 7) continue;
    if (crossesExisting(d, a, d.islands[j]!)) continue;
    d.bridges.push({ a: i, b: j, count: rng.chance(0.3) ? 2 : 1 });
  }

  return d;
}

/** Shift the drawing to hug the top-left so boards render without dead margins. */
function trim(d: Draft): { islands: { x: number; y: number }[]; w: number; h: number } {
  const minX = Math.min(...d.islands.map((i) => i.x));
  const minY = Math.min(...d.islands.map((i) => i.y));
  const islands = d.islands.map((i) => ({ x: i.x - minX, y: i.y - minY }));
  return {
    islands,
    w: Math.max(...islands.map((i) => i.x)) + 1,
    h: Math.max(...islands.map((i) => i.y)) + 1,
  };
}

export function generatePuzzle(
  seed: string,
  date: string,
  number: number,
  wanted: 1 | 2 | 3,
): Puzzle | null {
  const rng = createRng(seed);
  const size = SIZES[wanted];

  for (let attempt = 0; attempt < 400; attempt++) {
    const draft = growDraft(rng, size.w, size.h, size.islands);
    if (!draft) continue;

    const degrees = draft.islands.map((_, i) => degreeOf(draft, i));
    if (degrees.some((n) => n === 0 || n > 8)) continue;

    const trimmed = trim(draft);
    const puzzle: Puzzle = {
      id: `bridges-${date}`,
      game: 'bridges',
      date,
      number,
      difficulty: wanted,
      w: trimmed.w,
      h: trimmed.h,
      islands: trimmed.islands.map((p, i) => ({ x: p.x, y: p.y, n: degrees[i]! })),
    };

    const topo = buildTopology(puzzle);
    const report = solve(puzzle, 2, topo);

    // Non-negotiable: exactly one answer. Two answers is a bug the player
    // experiences as the game being broken.
    if (report.count !== 1) continue;

    // Board size carries most of the difficulty, but Monday and Tuesday get a
    // stronger promise: solvable by pure deduction, never by guessing. A
    // beginner who guesses on their first puzzle learns the wrong lesson.
    if (wanted === 1 && !report.logicOnly) continue;

    puzzle.difficulty = wanted;
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
      puzzle = generatePuzzle(`${dailySeed('bridges', date)}#${salt}`, date, number, difficulty);
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
  console.log(
    `bridges: ${puzzles.length} puzzles from ${start} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(`  easy ${byDiff[1] ?? 0} · medium ${byDiff[2] ?? 0} · hard ${byDiff[3] ?? 0}`);
  console.log(`  -> ${out}`);
}

// Run as a script (pnpm generate), importable as a module (tests, tools).
if (process.argv[1]?.includes('generate')) main();
