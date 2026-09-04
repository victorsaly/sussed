/**
 * The generator. Runs in CI, never in a browser.
 *
 * Strategy: place a valid set of stars first, cut the grid into regions
 * around them so every region holds exactly two, then throw the stars away.
 * That guarantees at least one solution by construction; the solver then has
 * to confirm there is exactly one.
 *
 *   pnpm --filter @sussed/twostars generate -- --days 400
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
import { buildUnits, type Puzzle } from './engine';
import { solve } from './solver';

export const EPOCH = '2026-01-01';
export const STARS = 2;

const SIZES: Record<1 | 2 | 3, number> = { 1: 8, 2: 9, 3: 10 };

/** Row by row, place `k` non-touching stars, keeping every column under `k`. */
export function placeStars(rng: Rng, n: number, k: number): number[] | null {
  const colCount = new Array<number>(n).fill(0);
  const rowsOf: number[][] = [];

  const okRow = (cols: number[], prev: number[] | undefined): boolean => {
    for (const c of cols) {
      if (colCount[c]! >= k) return false;
      if (prev && prev.some((pc) => Math.abs(pc - c) <= 1)) return false;
    }
    return true;
  };

  const step = (y: number): boolean => {
    if (y === n) return colCount.every((c) => c === k);
    // Columns still short of stars, weighted so late rows do not run out.
    const pairs: number[][] = [];
    for (let a = 0; a < n; a++) {
      for (let b = a + 2; b < n; b++) pairs.push([a, b]);
    }
    // Columns that are behind get priority: prefer pairs covering them.
    const remainingRows = n - y;
    const options = rng.shuffle(pairs);
    options.sort((p, q) => urgency(q) - urgency(p));
    function urgency(pair: number[]): number {
      let s = 0;
      for (const c of pair) if (k - colCount[c]! >= remainingRows) s += 10;
      return s;
    }
    for (const pair of options) {
      if (!okRow(pair, rowsOf[y - 1])) continue;
      for (const c of pair) colCount[c]!++;
      rowsOf.push(pair);
      if (step(y + 1)) return true;
      rowsOf.pop();
      for (const c of pair) colCount[c]!--;
    }
    return false;
  };

  if (!step(0)) return null;
  const out: number[] = [];
  rowsOf.forEach((cols, y) => cols.forEach((x) => out.push(y * n + x)));
  return out;
}

/**
 * Cut the grid into n connected regions, each holding exactly `k` of the
 * stars. Stars are paired up, a path is carved between each pair, then the
 * paths grow outward into the remaining cells, smallest region first so the
 * shapes stay roughly even.
 */
export function cutRegions(rng: Rng, n: number, k: number, stars: number[]): number[] | null {
  const cells = n * n;
  const region = new Array<number>(cells).fill(-1);
  const isStar = new Array<boolean>(cells).fill(false);
  for (const s of stars) isStar[s] = true;

  const x = (i: number): number => i % n;
  const y = (i: number): number => Math.floor(i / n);
  const ortho = (i: number): number[] => {
    const out: number[] = [];
    if (x(i) > 0) out.push(i - 1);
    if (x(i) < n - 1) out.push(i + 1);
    if (y(i) > 0) out.push(i - n);
    if (y(i) < n - 1) out.push(i + n);
    return out;
  };

  // Pair each star with a near unpaired one.
  const pool = rng.shuffle(stars.slice());
  const groups: number[][] = [];
  while (pool.length) {
    const a = pool.pop()!;
    const group = [a];
    for (let m = 1; m < k; m++) {
      let bestIdx = -1;
      let bestDist = Infinity;
      pool.forEach((b, idx) => {
        const d = Math.abs(x(a) - x(b)) + Math.abs(y(a) - y(b)) + rng.int(3);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = idx;
        }
      });
      if (bestIdx === -1) return null;
      group.push(pool.splice(bestIdx, 1)[0]!);
    }
    groups.push(group);
  }

  // Carve a path between the stars of each group through unclaimed cells.
  groups.forEach((group, r) => {
    for (const s of group) region[s] = r;
  });
  for (let r = 0; r < groups.length; r++) {
    const group = groups[r]!;
    for (let m = 1; m < group.length; m++) {
      const from = group[m - 1]!;
      const to = group[m]!;
      const prev = new Map<number, number>();
      const queue = [from];
      prev.set(from, -1);
      let found = false;
      while (queue.length && !found) {
        const cur = queue.shift()!;
        for (const nb of rng.shuffle(ortho(cur))) {
          if (prev.has(nb)) continue;
          const passable = nb === to || (region[nb] === -1 && !isStar[nb]) || (region[nb] === r);
          if (!passable) continue;
          prev.set(nb, cur);
          if (nb === to) {
            found = true;
            break;
          }
          queue.push(nb);
        }
      }
      if (!found) return null;
      let c = to;
      while (c !== -1) {
        region[c] = r;
        c = prev.get(c)!;
      }
    }
  }

  // Grow into the rest, giving each unclaimed cell to its smallest neighbour region.
  const size = new Array<number>(n).fill(0);
  for (const r of region) if (r !== -1) size[r]!++;
  let unclaimed = region.filter((r) => r === -1).length;
  let stuck = 0;
  while (unclaimed > 0) {
    const i = rng.int(cells);
    if (region[i] !== -1) continue;
    const candidates = ortho(i).filter((j) => region[j] !== -1);
    if (candidates.length === 0) {
      if (++stuck > cells * 50) return null;
      continue;
    }
    // Stars may only join a region that still needs them; here every region
    // already has its stars, so a stray star cell would break the count.
    if (isStar[i]) return null;
    let pick = candidates[0]!;
    for (const j of candidates) {
      const a = size[region[j]!]!;
      const b = size[region[pick]!]!;
      if (a < b || (a === b && rng.chance(0.5))) pick = j;
    }
    region[i] = region[pick]!;
    size[region[i]!]!++;
    unclaimed--;
  }
  return region;
}

/** Is region `r` still one connected piece if `without` is taken out of it? */
function stillConnected(p: Puzzle, r: number, without: number): boolean {
  const n = p.n;
  const members = new Set<number>();
  p.regions.forEach((reg, i) => {
    if (reg === r && i !== without) members.add(i);
  });
  if (members.size === 0) return false;
  const [first] = members;
  const seen = new Set<number>([first!]);
  const queue = [first!];
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % n;
    const y = Math.floor(i / n);
    for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) {
      if (j >= 0 && members.has(j) && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen.size === members.size;
}

/**
 * Random regions almost never give a unique puzzle at this size, so repair
 * them: while a second solution exists, take one of its stars that the
 * intended solution does not use and move that cell into a neighbouring
 * region. The intended answer keeps its counts; the rival loses one of its
 * regions' pairs. Every move kills at least one alternative.
 */
export function makeUnique(rng: Rng, puzzle: Puzzle, intended: number[]): boolean {
  const n = puzzle.n;
  const mine = new Set(intended);
  for (let round = 0; round < 80; round++) {
    const report = solve(puzzle, 2, buildUnits(puzzle));
    if (report.count === 1) return true;
    if (report.count === 0) return false;
    const rival = report.solutions.find((sol) => intended.some((i) => sol[i] !== 2)) ?? report.solutions[1];
    if (!rival) return false;

    const candidates = rng.shuffle(
      rival.map((m, i) => (m === 2 && !mine.has(i) ? i : -1)).filter((i) => i !== -1),
    );
    let moved = false;
    for (const c of candidates) {
      const x = c % n;
      const y = Math.floor(c / n);
      const from = puzzle.regions[c]!;
      const neighbours = rng.shuffle(
        [x > 0 ? c - 1 : -1, x < n - 1 ? c + 1 : -1, y > 0 ? c - n : -1, y < n - 1 ? c + n : -1].filter(
          (j) => j >= 0 && puzzle.regions[j] !== from,
        ),
      );
      for (const j of neighbours) {
        if (!stillConnected(puzzle, from, c)) break;
        puzzle.regions[c] = puzzle.regions[j]!;
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (!moved) return false;
  }
  return false;
}

export function generatePuzzle(
  seed: string,
  date: string,
  number: number,
  wanted: 1 | 2 | 3,
): Puzzle | null {
  const rng = createRng(seed);
  const n = SIZES[wanted];

  for (let attempt = 0; attempt < 600; attempt++) {
    const stars = placeStars(rng, n, STARS);
    if (!stars) continue;
    const regions = cutRegions(rng, n, STARS, stars);
    if (!regions) continue;

    const puzzle: Puzzle = {
      id: `twostars-${date}`,
      game: 'twostars',
      date,
      number,
      difficulty: wanted,
      n,
      stars: STARS,
      regions,
    };

    if (!makeUnique(rng, puzzle, stars)) continue;
    const report = solve(puzzle, 2, buildUnits(puzzle));

    // Non-negotiable: exactly one answer.
    if (report.count !== 1) continue;

    // Monday and Tuesday: solvable by the techniques alone, never by guessing.
    if (wanted === 1 && !report.logicOnly) continue;

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
      puzzle = generatePuzzle(`${dailySeed('twostars', date)}#${salt}`, date, number, difficulty);
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
    `twostars: ${puzzles.length} puzzles from ${start} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  console.log(`  easy ${byDiff[1] ?? 0} · medium ${byDiff[2] ?? 0} · hard ${byDiff[3] ?? 0}`);
  console.log(`  -> ${out}`);
}

// Run as a script (pnpm generate), importable as a module (tests, tools).
if (process.argv[1]?.includes('generate')) main();
