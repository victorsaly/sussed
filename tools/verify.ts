/**
 * The CI gate.
 *
 * Nothing ships to players that this script hasn't re-solved from scratch.
 * It deliberately re-runs the solver rather than trusting the generator's own
 * word — the generator is the thing most likely to have a bug, so it does not
 * get to mark its own homework.
 *
 *   pnpm verify
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allLevels, type LevelSet } from '../packages/core/src/levels';
import * as bridges from '../games/bridges/src/engine';
import { solve as solveBridges } from '../games/bridges/src/solver';
import { BRIDGES_LEVELS, levelPuzzle as bridgesLevel, teachingFor as bridgesTeaching } from '../games/bridges/src/levels';
import * as twostars from '../games/twostars/src/engine';
import { solve as solveTwoStars } from '../games/twostars/src/solver';
import { TWOSTARS_LEVELS, levelPuzzle as twostarsLevel, teachingFor as twostarsTeaching } from '../games/twostars/src/levels';
import * as loop from '../games/loop/src/engine';
import { solve as solveLoop } from '../games/loop/src/solver';
import { LOOP_LEVELS, levelPuzzle as loopLevel, teachingFor as loopTeaching } from '../games/loop/src/levels';
import { parFloor, type Puzzle as ArrowsPuzzle } from '../games/arrows/src/engine';
import { solve as solveArrows } from '../games/arrows/src/solver';

interface Bundle<P> {
  epoch: string;
  start: string;
  puzzles: P[];
}

interface Report {
  count: number;
  logicOnly: boolean;
  valid: boolean;
}

interface Dated {
  date: string;
  number: number;
  difficulty: number;
}

interface Game<P extends Dated> {
  slug: string;
  path: string;
  /** structural problems with a puzzle, before solving */
  shape(p: P): string | null;
  solve(p: P): Report;
  /** how big a board may be and still count as teaching one rule */
  size(p: P): number;
  maxTeachingSize: number;
  /**
   * Whether every course board must fall to the solver's techniques alone.
   * False only where the solver leaves a rule to search — Bridges reasons
   * about counts, not connectivity, and its connectivity chapter is meant to
   * be seen, not deduced.
   */
  courseMustBeLogic: boolean;
  levels: LevelSet;
  levelPuzzle(id: string): P | null;
  teachingFor(id: string): unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GAMES: Game<any>[] = [
  {
    slug: 'bridges',
    path: 'games/bridges/public/puzzles.json',
    shape(p: bridges.Puzzle) {
      if (p.islands.length < 4) return `only ${p.islands.length} islands`;
      for (const island of p.islands) {
        if (island.n < 1 || island.n > 8) return `island with impossible count ${island.n}`;
      }
      return null;
    },
    solve(p: bridges.Puzzle) {
      const topo = bridges.buildTopology(p);
      const r = solveBridges(p, 2, topo);
      return { count: r.count, logicOnly: r.logicOnly, valid: !!r.solution && bridges.isSolved(p, topo, r.solution) };
    },
    size: (p: bridges.Puzzle) => p.islands.length,
    maxTeachingSize: 6,
    courseMustBeLogic: false,
    levels: BRIDGES_LEVELS,
    levelPuzzle: bridgesLevel,
    teachingFor: bridgesTeaching,
  },
  {
    slug: 'twostars',
    path: 'games/twostars/public/puzzles.json',
    shape(p: twostars.Puzzle) {
      if (p.regions.length !== p.n * p.n) return `grid has ${p.regions.length} cells for n=${p.n}`;
      const seen = new Set(p.regions);
      if (seen.size !== p.n) return `${seen.size} regions for n=${p.n}`;
      for (const r of p.regions) if (r < 0 || r >= p.n) return `region id ${r} out of range`;
      return null;
    },
    solve(p: twostars.Puzzle) {
      const units = twostars.buildUnits(p);
      const r = solveTwoStars(p, 2, units);
      return { count: r.count, logicOnly: r.logicOnly, valid: !!r.solution && twostars.isSolved(p, units, r.solution) };
    },
    size: (p: twostars.Puzzle) => p.n,
    // Two stars per line has no pure-deduction board smaller than 8, so the
    // chapter that introduces it is the smallest real board.
    maxTeachingSize: 8,
    courseMustBeLogic: true,
    levels: TWOSTARS_LEVELS,
    levelPuzzle: twostarsLevel,
    teachingFor: twostarsTeaching,
  },
  {
    slug: 'loop',
    path: 'games/loop/public/puzzles.json',
    shape(p: loop.Puzzle) {
      if (p.clues.length !== p.w * p.h) return `grid has ${p.clues.length} cells for ${p.w}x${p.h}`;
      const given = p.clues.filter((c) => c >= 0);
      if (given.length < 4) return `only ${given.length} clues`;
      for (const c of p.clues) if (c < -1 || c > 3) return `clue ${c} out of range`;
      return null;
    },
    solve(p: loop.Puzzle) {
      const topo = loop.buildTopology(p);
      const r = solveLoop(p, 2, topo);
      return { count: r.count, logicOnly: r.logicOnly, valid: !!r.solution && loop.isSolved(p, topo, r.solution) };
    },
    size: (p: loop.Puzzle) => Math.max(p.w, p.h),
    maxTeachingSize: 4,
    courseMustBeLogic: true,
    levels: LOOP_LEVELS,
    levelPuzzle: loopLevel,
    teachingFor: loopTeaching,
  },
];

let failures = 0;

for (const game of GAMES) {
  const file = resolve(process.cwd(), game.path);
  let bundle: Bundle<Dated>;
  try {
    bundle = JSON.parse(readFileSync(file, 'utf8')) as Bundle<Dated>;
  } catch {
    console.error(`✗ ${game.slug}: no puzzle bundle at ${game.path} — run pnpm generate`);
    failures++;
    continue;
  }

  const seenDates = new Set<string>();
  let guessy = 0;
  const t0 = Date.now();

  for (const puzzle of bundle.puzzles) {
    const where = `${game.slug} ${puzzle.date} (#${puzzle.number})`;

    if (seenDates.has(puzzle.date)) {
      console.error(`✗ ${where}: duplicate date`);
      failures++;
    }
    seenDates.add(puzzle.date);

    const problem = game.shape(puzzle);
    if (problem) {
      console.error(`✗ ${where}: ${problem}`);
      failures++;
      continue;
    }

    const report = game.solve(puzzle);

    if (report.count === 0) {
      console.error(`✗ ${where}: no solution`);
      failures++;
    } else if (report.count > 1) {
      console.error(`✗ ${where}: more than one solution — ambiguous`);
      failures++;
    } else if (!report.valid) {
      console.error(`✗ ${where}: solver returned a solution that is not valid`);
      failures++;
    }

    if (puzzle.difficulty === 1 && !report.logicOnly) {
      console.error(`✗ ${where}: marked easy but needs guessing`);
      failures++;
    }
    if (!report.logicOnly) guessy++;
  }

  const ms = Date.now() - t0;
  console.log(
    `${failures === 0 ? '✓' : '✗'} ${game.slug}: ${bundle.puzzles.length} puzzles re-solved in ${(ms / 1000).toFixed(1)}s ` +
      `· ${bundle.puzzles.length - guessy} pure-deduction, ${guessy} need a look-ahead`,
  );
}

/* ---- the teaching courses ----------------------------------------------
   A course level with two answers, or one that needs a guess, teaches the
   wrong lesson at exactly the moment a player is deciding whether to stay. */
for (const game of GAMES) {
  const levels = allLevels(game.levels);
  let bad = 0;
  for (const ref of levels) {
    const puzzle = game.levelPuzzle(ref.id);
    if (!puzzle) {
      console.error(`✗ ${game.slug} course ${ref.id}: no puzzle defined`);
      bad++;
      continue;
    }
    if (!game.teachingFor(ref.id)) {
      console.error(`✗ ${game.slug} course ${ref.id}: no rule declared — every chapter must teach exactly one`);
      bad++;
    }
    const report = game.solve(puzzle);
    if (report.count !== 1) {
      console.error(`✗ ${game.slug} course ${ref.id}: ${report.count === 0 ? 'no solution' : 'more than one solution'}`);
      bad++;
    } else if (game.courseMustBeLogic && !report.logicOnly) {
      console.error(`✗ ${game.slug} course ${ref.id}: needs a guess — a teaching board must be pure deduction`);
      bad++;
    }
    if (game.size(puzzle) > game.maxTeachingSize) {
      console.error(`✗ ${game.slug} course ${ref.id}: too big — a teaching board should show one rule, not a puzzle`);
      bad++;
    }
  }
  failures += bad;
  console.log(`${bad === 0 ? '✓' : '✗'} ${game.slug} course: ${levels.length} teaching levels, each with exactly one answer`);
}

/* ---- par-based games ----------------------------------------------------
   Arrows deliberately sits outside the GAMES registry above. That registry
   verifies one property — exactly one solution — and Arrows has no such
   property: every board has many solutions and the promise is the PAR, the
   fewest taps that clear it. A par printed under a board is a promise, and
   every score built on it inherits the lie if it is wrong, so each shipped
   puzzle is re-solved from scratch and its par compared. */
{
  const file = resolve(process.cwd(), 'games/arrows/public/puzzles.json');
  let bundle: { puzzles: ArrowsPuzzle[] } | null = null;
  try {
    bundle = JSON.parse(readFileSync(file, 'utf8')) as { puzzles: ArrowsPuzzle[] };
  } catch {
    console.log('· arrows: no bundle — skipping (run pnpm generate)');
  }

  if (bundle) {
    const before = failures;
    const t0 = Date.now();
    const seen = new Set<string>();

    for (const puzzle of bundle.puzzles) {
      const where = `arrows ${puzzle.date} (#${puzzle.number})`;
      if (seen.has(puzzle.date)) {
        console.error(`✗ ${where}: duplicate date`);
        failures++;
      }
      seen.add(puzzle.date);

      // Every arrow must leave, and leaving costs a tap, so this floor is
      // arithmetic. A par below it means something is badly wrong.
      const floor = parFloor(puzzle);
      if (puzzle.par < floor) {
        console.error(`✗ ${where}: par ${puzzle.par} below the floor of ${floor}`);
        failures++;
      }

      const report = solveArrows(puzzle);
      if (report.unrated) {
        console.error(`✗ ${where}: solver could not prove a par within budget`);
        failures++;
      } else if (report.par !== puzzle.par) {
        console.error(`✗ ${where}: shipped par ${puzzle.par}, solver says ${report.par}`);
        failures++;
      }

      // Monday and Tuesday promise a board with nothing in anything's way.
      if (puzzle.difficulty === 1 && puzzle.par !== floor) {
        console.error(`✗ ${where}: marked easy but needs ${puzzle.par - floor} rotation(s)`);
        failures++;
      }
    }

    const rotations = bundle.puzzles.reduce((n, p) => n + (p.par - parFloor(p)), 0);
    console.log(
      `${failures === before ? '✓' : '✗'} arrows: ${bundle.puzzles.length} pars re-derived in ` +
        `${((Date.now() - t0) / 1000).toFixed(1)}s · ${rotations} rotations across the set`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} problem(s). Nothing ships until this is clean.`);
  process.exit(1);
}
console.log('\nAll good.');
