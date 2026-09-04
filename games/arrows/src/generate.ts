/**
 * The Arrows generator. Runs in CI, never in a browser.
 *
 * Random boards, then filtered hard. The filtering is the whole thing: most
 * random arrangements are either trivially clearable in any order, or dead on
 * arrival. What is wanted is the narrow band where the board can be cleared but
 * most of the obvious openings strand it.
 *
 *   pnpm --filter @sussed/arrows generate -- --days 400
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDays,
  createRng,
  dailySeed,
  difficultyForDate,
  puzzleNumber,
  toIsoDate,
  type Rng,
} from '@sussed/core';
import type { Dir, Puzzle, TileDef } from './engine';
import { solve } from './solver';

export const EPOCH = '2026-01-01';

const SIZES: Record<1 | 2 | 3, { w: number; h: number; tiles: number }> = {
  1: { w: 4, h: 4, tiles: 6 },
  2: { w: 4, h: 4, tiles: 8 },
  3: { w: 5, h: 5, tiles: 9 },
};

/**
 * How many rotations par must demand. This IS the difficulty: a board that
 * clears in one tap per arrow had nothing in anything's way, and every tap
 * above that floor is an arrow the player had to spot was stuck and turn.
 */
const EXCESS: Record<1 | 2 | 3, { min: number; max: number }> = {
  1: { min: 0, max: 0 },
  2: { min: 1, max: 2 },
  3: { min: 3, max: 8 },
};

function randomBoard(rng: Rng, w: number, h: number, count: number): TileDef[] {
  const cells: number[] = [];
  for (let i = 0; i < w * h; i++) cells.push(i);
  const chosen = rng.shuffle(cells).slice(0, count);
  return chosen.map((c) => ({
    x: c % w,
    y: Math.floor(c / w),
    dir: rng.int(4) as Dir,
  }));
}

export function generatePuzzle(
  seed: string,
  date: string,
  number: number,
  wanted: 1 | 2 | 3,
): Puzzle | null {
  const rng = createRng(seed);
  const size = SIZES[wanted];

  for (let attempt = 0; attempt < 600; attempt++) {
    const tiles = randomBoard(rng, size.w, size.h, size.tiles);
    const puzzle: Puzzle = {
      id: `arrows-${date}`,
      game: 'arrows',
      date,
      number,
      difficulty: wanted,
      w: size.w,
      h: size.h,
      tiles,
      par: 0,
    };

    const report = solve(puzzle);

    // A par the solver could not prove is a par we will not print.
    if (report.unrated || report.par === Infinity) continue;

    const band = EXCESS[wanted];
    if (report.excess < band.min || report.excess > band.max) continue;

    puzzle.par = report.par;
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
    for (let salt = 0; salt < 20 && !puzzle; salt++) {
      puzzle = generatePuzzle(`${dailySeed('arrows', date)}#${salt}`, date, number, difficulty);
    }
    if (!puzzle) throw new Error(`Could not generate an arrows puzzle for ${date}`);
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
  const avgExcess = (
    puzzles.reduce((n, p) => n + (p.par - p.tiles.length), 0) / puzzles.length
  ).toFixed(1);
  console.log(
    `arrows: ${puzzles.length} puzzles from ${start} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(
    `  easy ${byDiff[1] ?? 0} · medium ${byDiff[2] ?? 0} · hard ${byDiff[3] ?? 0} · avg rotations needed ${avgExcess}`,
  );
  console.log(`  -> ${out}`);
}

if (process.argv[1]?.includes('generate')) main();
