/**
 * The Arrows generator. Runs in CI, never in a browser.
 *
 * Construction, not rejection. `buildBoard` cannot produce a board that fails
 * to come apart, so this file is not hunting for the rare good arrangement — it
 * is tuning the ones it gets until the board is as tight as its difficulty
 * claims. The solver's job here is to disagree: a board it cannot clear is a
 * bug in the construction, not a hard puzzle, and it throws rather than ships.
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
} from '@sussed/core';
import { buildBoard, type BoardSpec } from './construct';
import { density, headAligned, isContiguous, type Puzzle } from './engine';
import { rate, solve } from './solver';

export const EPOCH = '2026-01-01';

/**
 * Size and fullness by difficulty.
 *
 * Density is the real dial. A sparse board shows you four clear runs at a
 * glance; a full one hides the same runs among a dozen arrowheads, and that
 * scanning is the game. Size grows too, but only so the density has somewhere
 * to live.
 */
const SPECS: Record<1 | 2 | 3, BoardSpec> = {
  1: { w: 5, h: 6, density: 0.58, minLen: 3, maxLen: 5 },
  2: { w: 6, h: 7, density: 0.72, minLen: 3, maxLen: 6, tighten: true },
  3: { w: 7, h: 8, density: 0.82, minLen: 3, maxLen: 7, tighten: true },
};

/**
 * The tightest moment a board of each difficulty is allowed to have, as the
 * share of live paths that could go — see `minFreeRatio` in the solver.
 *
 * Monday and Tuesday are difficulty 1 by the shared calendar, and the studio
 * rule that those are solvable without guessing lands here as a floor rather
 * than a deduction argument: at no point may fewer than a third of the paths
 * on the board be free, so there is always something plainly available to see.
 */
const BANDS: Record<1 | 2 | 3, { minRatio: number; maxBottlenecks: number }> = {
  1: { minRatio: 0.33, maxBottlenecks: 0 },
  2: { minRatio: 0.18, maxBottlenecks: 3 },
  3: { minRatio: 0, maxBottlenecks: 99 },
};

export function generatePuzzle(
  seed: string,
  date: string,
  number: number,
  wanted: 1 | 2 | 3,
): Puzzle | null {
  const rng = createRng(seed);
  const spec = SPECS[wanted];

  for (let attempt = 0; attempt < 240; attempt++) {
    const paths = buildBoard(rng, spec);
    if (paths.length < 4) continue;

    const puzzle: Puzzle = {
      id: `arrows-${date}`,
      game: 'arrows',
      date,
      number,
      difficulty: wanted,
      w: spec.w,
      h: spec.h,
      paths,
    };

    // Construction should make these impossible. Checking anyway is the whole
    // reason the generator does not get to mark its own homework.
    for (const path of paths) {
      if (!isContiguous(puzzle, path)) {
        throw new Error(`generator produced a broken path on ${date}`);
      }
      if (!headAligned(puzzle, path)) {
        throw new Error(`generator produced a lying arrowhead on ${date}`);
      }
    }

    const report = solve(puzzle);
    if (!report.cleared) {
      throw new Error(`generator produced a board that strands ${report.stranded} paths on ${date}`);
    }

    const band = BANDS[wanted];
    if (report.minFreeRatio < band.minRatio) continue;
    if (report.bottlenecks > band.maxBottlenecks) continue;
    if (rate(report) !== wanted) continue;
    if (density(puzzle) < spec.density - 0.12) continue;

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
    for (let salt = 0; salt < 30 && !puzzle; salt++) {
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
  const avgDensity = (
    (puzzles.reduce((n, p) => n + density(p), 0) / puzzles.length) *
    100
  ).toFixed(0);
  const avgPaths = (puzzles.reduce((n, p) => n + p.paths.length, 0) / puzzles.length).toFixed(1);

  console.log(
    `arrows: ${puzzles.length} puzzles from ${start} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(
    `  easy ${byDiff[1] ?? 0} · medium ${byDiff[2] ?? 0} · hard ${byDiff[3] ?? 0} · avg ${avgPaths} paths at ${avgDensity}% full`,
  );
  console.log(`  -> ${out}`);
}

if (process.argv[1]?.includes('generate')) main();
