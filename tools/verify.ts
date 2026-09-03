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
import { allLevels } from '../packages/core/src/levels';
import { buildTopology, isSolved, type Puzzle } from '../games/bridges/src/engine';
import { solve } from '../games/bridges/src/solver';
import { BRIDGES_LEVELS, levelPuzzle, teachingFor } from '../games/bridges/src/levels';

interface Bundle {
  epoch: string;
  start: string;
  puzzles: Puzzle[];
}

const GAMES = [{ slug: 'bridges', path: 'games/bridges/public/puzzles.json' }];

let failures = 0;

for (const game of GAMES) {
  const file = resolve(process.cwd(), game.path);
  let bundle: Bundle;
  try {
    bundle = JSON.parse(readFileSync(file, 'utf8')) as Bundle;
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

    if (puzzle.islands.length < 4) {
      console.error(`✗ ${where}: only ${puzzle.islands.length} islands`);
      failures++;
      continue;
    }
    for (const island of puzzle.islands) {
      if (island.n < 1 || island.n > 8) {
        console.error(`✗ ${where}: island with impossible count ${island.n}`);
        failures++;
      }
    }

    const topo = buildTopology(puzzle);
    const report = solve(puzzle, 2, topo);

    if (report.count === 0) {
      console.error(`✗ ${where}: no solution`);
      failures++;
    } else if (report.count > 1) {
      console.error(`✗ ${where}: more than one solution — ambiguous`);
      failures++;
    } else if (!report.solution || !isSolved(puzzle, topo, report.solution)) {
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

/* ---- the teaching course ------------------------------------------------
   A course level with two answers, or one that needs a guess, teaches the
   wrong lesson at exactly the moment a player is deciding whether to stay. */
{
  const levels = allLevels(BRIDGES_LEVELS);
  for (const ref of levels) {
    const puzzle = levelPuzzle(ref.id);
    if (!puzzle) {
      console.error(`✗ course ${ref.id}: no puzzle defined`);
      failures++;
      continue;
    }
    if (!teachingFor(ref.id)) {
      console.error(`✗ course ${ref.id}: no rule declared — every chapter must teach exactly one`);
      failures++;
    }
    const topo = buildTopology(puzzle);
    const report = solve(puzzle, 2, topo);
    if (report.count !== 1) {
      console.error(`✗ course ${ref.id}: ${report.count === 0 ? 'no solution' : 'more than one solution'}`);
      failures++;
    }
    if (puzzle.islands.length > 6) {
      console.error(`✗ course ${ref.id}: ${puzzle.islands.length} islands — a teaching board should show one rule, not a puzzle`);
      failures++;
    }
  }
  console.log(`${failures === 0 ? '✓' : '✗'} course: ${levels.length} teaching levels, each with exactly one answer`);
}

if (failures > 0) {
  console.error(`\n${failures} problem(s). Nothing ships until this is clean.`);
  process.exit(1);
}
console.log('\nAll good.');
