/**
 * Builds each game's difficulty ladder, once, and writes it as committed data.
 *
 * The course used to stop at the teaching chapters: five or so boards that
 * introduce the rules and then hand you a daily. That leaves nowhere to go for
 * someone who wants to get better before being graded by the calendar, and it
 * left three of the four games short of the ten levels their own rules sheet
 * promises before the daily opens.
 *
 * So each course now continues into a graded run — gentle, then middling, then
 * hard — and difficulty is where you have got to rather than a menu you pick
 * from. That was the deliberate choice: a picker in front of the board is one
 * more thing between arriving and playing.
 *
 * These boards are generated ONCE and committed, not chosen from the shipped
 * bundle at runtime. The bundle is regenerated on every deploy, so drawing
 * from it would quietly change the board behind a level a player had already
 * solved. A level id is in someone's history forever; the board under it has
 * to stay put.
 *
 *   pnpm ladder            → rewrites games/<slug>/src/ladder.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as bridges from '../games/bridges/src/engine';
import { generatePuzzle as genBridges } from '../games/bridges/src/generate';
import { solve as solveBridges } from '../games/bridges/src/solver';

import * as twostars from '../games/twostars/src/engine';
import { generatePuzzle as genTwoStars } from '../games/twostars/src/generate';
import { solve as solveTwoStars } from '../games/twostars/src/solver';

import * as loop from '../games/loop/src/engine';
import { generatePuzzle as genLoop } from '../games/loop/src/generate';
import { solve as solveLoop } from '../games/loop/src/solver';

import * as arrows from '../games/arrows/src/engine';
import { generatePuzzle as genArrows } from '../games/arrows/src/generate';
import { solve as solveArrows, rate as rateArrows } from '../games/arrows/src/solver';

/**
 * The shape of the ladder, and it is the same for every game: a gentle pair to
 * find your feet after the teaching, three in the middle, then two that are as
 * hard as a Sunday. Seven rungs, which puts every course past the ten levels
 * the daily waits for.
 */
const RUNGS: { difficulty: 1 | 2 | 3; title: string; teaches: string }[] = [
  { difficulty: 1, title: 'On your own', teaches: 'No new rules from here. Just boards.' },
  { difficulty: 1, title: 'A little more', teaches: 'Same size, less given away.' },
  { difficulty: 2, title: 'Middling', teaches: 'Bigger. Everything still follows.' },
  { difficulty: 2, title: 'Keep going', teaches: 'You will need to look further ahead.' },
  { difficulty: 2, title: 'Most of a week', teaches: 'About as hard as a Wednesday.' },
  { difficulty: 3, title: 'Sunday sized', teaches: 'This is what the weekend looks like.' },
  { difficulty: 3, title: 'The last one', teaches: 'Finish this and the daily is yours.' },
];

interface Spec {
  slug: string;
  /** the fields that are the board, everything except the identifying ones */
  board(p: Record<string, unknown>): Record<string, unknown>;
  generate(seed: string, difficulty: 1 | 2 | 3): unknown;
  /** must return exactly one solution, or the rung is thrown away */
  unique(p: unknown): boolean;
}

const SPECS: Spec[] = [
  {
    slug: 'bridges',
    board: (p) => ({ w: p.w, h: p.h, islands: p.islands }),
    generate: (seed, d) => genBridges(seed, '', 0, d),
    unique: (p) => solveBridges(p as bridges.Puzzle, 2, bridges.buildTopology(p as bridges.Puzzle)).count === 1,
  },
  {
    slug: 'twostars',
    board: (p) => ({ n: p.n, stars: p.stars, regions: p.regions }),
    generate: (seed, d) => genTwoStars(seed, '', 0, d),
    unique: (p) => solveTwoStars(p as twostars.Puzzle, 2, twostars.buildUnits(p as twostars.Puzzle)).count === 1,
  },
  {
    slug: 'loop',
    board: (p) => ({ w: p.w, h: p.h, clues: p.clues }),
    generate: (seed, d) => genLoop(seed, '', 0, d),
    unique: (p) => solveLoop(p as loop.Puzzle, 2, loop.buildTopology(p as loop.Puzzle)).count === 1,
  },
  {
    slug: 'arrows',
    board: (p) => ({ w: p.w, h: p.h, paths: p.paths }),
    generate: (seed, d) => genArrows(seed, '', 0, d),
    // Arrows is confluent and cannot claim a unique solution. Its promise is
    // that the board comes apart at all, and at the difficulty it claims.
    unique: (p) => {
      const report = solveArrows(p as arrows.Puzzle);
      return report.cleared && rateArrows(report) === (p as arrows.Puzzle).difficulty;
    },
  },
];

function build(spec: Spec): string {
  const rows: string[] = [];

  RUNGS.forEach((rung, i) => {
    const n = `${i + 1}`.padStart(2, '0');
    let found: Record<string, unknown> | null = null;

    for (let salt = 0; salt < 400 && !found; salt++) {
      const p = spec.generate(`ladder:${spec.slug}:${n}#${salt}`, rung.difficulty) as Record<
        string,
        unknown
      > | null;
      if (!p) continue;
      if (!spec.unique(p)) continue;
      found = spec.board(p);
    }
    if (!found) throw new Error(`${spec.slug}: no board for rung ${n} at difficulty ${rung.difficulty}`);

    const fields = Object.entries(found)
      .map(([k, v]) => `      ${k}: ${JSON.stringify(v)},`)
      .join('\n');
    rows.push(
      `  {\n    chapter: 'ladder-${n}',\n    title: ${JSON.stringify(rung.title)},\n` +
        `    teaches: ${JSON.stringify(rung.teaches)},\n    difficulty: ${rung.difficulty},\n` +
        `    board: {\n${fields}\n    },\n  },`,
    );
    console.log(`  ${spec.slug} ladder-${n} · difficulty ${rung.difficulty}`);
  });

  return `/**
 * The difficulty ladder — generated by tools/build-ladder.ts, not written by hand.
 *
 * Rebuild with \`pnpm ladder\`. Do not edit: these boards are in players'
 * histories by level id, so changing one silently swaps the puzzle under
 * somebody's solved result.
 */

import type { Puzzle } from './engine';

/** Everything except the fields that identify a puzzle rather than describe it. */
export type Board = Omit<Puzzle, 'id' | 'game' | 'date' | 'number' | 'difficulty'>;

export interface Rung {
  chapter: string;
  title: string;
  teaches: string;
  difficulty: 1 | 2 | 3;
  /** kept behind its own key so it can be spread into a Puzzle without
      dragging the chapter's own fields in with it */
  board: Board;
}

export const LADDER: Rung[] = [
${rows.join('\n')}
];
`;
}

function main(): void {
  const only = process.argv.slice(2);
  const root = resolve(import.meta.dirname, '..');

  for (const spec of SPECS) {
    if (only.length > 0 && !only.includes(spec.slug)) continue;
    console.log(`· ${spec.slug}`);
    const out = resolve(root, 'games', spec.slug, 'src/ladder.ts');
    writeFileSync(out, build(spec));
    console.log(`  -> ${out}`);
  }
}

main();
